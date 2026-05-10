const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static');

/**
 * CLEAN CUT AUDIO EDITOR - BACKEND
 * Minimal audio processing server using FFmpeg
 */

// Configure FFmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

const app = express();
const PORT = process.env.PORT || 5001;

// In-memory storage for uploaded file metadata
const fileMetadataMap = new Map();

// Initialize required directories
const uploadDir = path.join(__dirname, '../uploads');
const downloadDir = path.join(__dirname, '../downloads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use('/downloads', express.static(downloadDir));

// Serve React static files (Frontend)
const clientDistDir = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistDir));

// --- MULTER CONFIGURATION ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.aac'];
    const ext = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext) ? cb(null, true) : cb(new Error('Unsupported file format'), false);
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB Limit
});

// --- HELPER FUNCTIONS ---

/**
 * Converts silence segments and manual ranges into a list of segments to DELETE.
 * Applies padding (여백) to silence segments only.
 */
const buildDeleteRanges = (silenceSegments, manualDeleteRanges, padding, totalDuration) => {
  const ranges = [];
  
  // Apply padding to silence segments: delete slightly less than the detected silence
  silenceSegments.forEach(seg => {
    const start = Math.max(0, seg.start + padding);
    const end = Math.min(totalDuration, seg.end - padding);
    if (end > start) ranges.push({ start, end });
  });
  
  // Manual ranges are deleted exactly as selected
  manualDeleteRanges.forEach(seg => {
    const start = Math.max(0, seg.start);
    const end = Math.min(totalDuration, seg.end);
    if (end > start) ranges.push({ start, end });
  });
  
  return ranges;
};

/**
 * Merges overlapping or adjacent delete ranges to simplify the timeline.
 */
const mergeRanges = (ranges) => {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
};

/**
 * Inverts delete ranges to find the segments that should be KEPT.
 * If total is 60 and delete is 10-20, keep is 0-10 and 20-60.
 */
const buildKeepSegments = (deleteRanges, totalDuration) => {
  const keep = [];
  let lastEnd = 0;
  
  deleteRanges.forEach(range => {
    if (range.start > lastEnd) {
      keep.push({ start: lastEnd, end: range.start });
    }
    lastEnd = Math.max(lastEnd, range.end);
  });
  
  if (lastEnd < totalDuration) {
    keep.push({ start: lastEnd, end: totalDuration });
  }
  return keep;
};

// --- API ENDPOINTS ---

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: '클린컷 API가 정상 작동 중입니다.' });
});

app.post('/api/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

  ffmpeg.ffprobe(req.file.path, (err, metadata) => {
    if (err) {
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ success: false, error: 'Corrupt or invalid audio file' });
    }

    const fileId = crypto.randomUUID();
    // Multer encodes non-ASCII filenames as latin1; decode to UTF-8 for Korean support
    const decodedFilename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const fileData = {
      fileId,
      originalFilename: decodedFilename,
      uploadedFileUrl: `/uploads/${req.file.filename}`,
      duration: parseFloat(metadata.format.duration),
      path: req.file.path
    };

    fileMetadataMap.set(fileId, fileData);
    res.json({ success: true, ...fileData });
  });
});

/**
 * FFmpeg Silence Detection
 * Uses silencedetect filter to find quiet sections.
 * We parse stderr to capture silence_start and silence_end logs.
 */
app.post('/api/detect-silence', (req, res) => {
  const { fileId, silenceThreshold = -40, minSilenceDuration = 0.5 } = req.body;
  const fileData = fileMetadataMap.get(fileId);
  if (!fileData) return res.status(404).json({ success: false, error: 'File not found' });

  const threshold = parseFloat(silenceThreshold);
  const duration = parseFloat(minSilenceDuration);

  const silenceSegments = [];
  let currentSegment = null;

  ffmpeg(fileData.path)
    .audioFilters(`silencedetect=noise=${threshold}dB:d=${duration}`)
    .format('null') // No output file, just analysis
    .on('stderr', (line) => {
      // Parse FFmpeg logs for silence markers
      const startMatch = line.match(/silence_start: ([\d.]+)/);
      const endMatch = line.match(/silence_end: ([\d.]+)/);
      if (startMatch) {
        currentSegment = { start: parseFloat(startMatch[1]) };
      } else if (endMatch && currentSegment) {
        currentSegment.end = parseFloat(endMatch[1]);
        currentSegment.duration = currentSegment.end - currentSegment.start;
        silenceSegments.push(currentSegment);
        currentSegment = null;
      }
    })
    .on('end', () => res.json({ success: true, duration: fileData.duration, silenceSegments }))
    .on('error', (err) => res.status(500).json({ success: false, error: 'Silence detection failed' }))
    .save('null');
});

/**
 * Audio Processing (Trim + Normalize + Limit)
 */
app.post('/api/process', (req, res) => {
  const { 
    fileId, silenceSegments = [], manualDeleteRanges = [], padding = 0.15,
    targetLufs = -14, truePeak = -1.0, limiterEnabled = true,
    outputFormat = 'wav', bitrate = '192k'
  } = req.body;

  const fileData = fileMetadataMap.get(fileId);
  if (!fileData) return res.status(404).json({ success: false, error: 'File not found' });

  // 1. Calculate what to keep
  const totalDuration = fileData.duration;
  const deleteRanges = mergeRanges(buildDeleteRanges(silenceSegments, manualDeleteRanges, parseFloat(padding), totalDuration));
  const keepSegments = buildKeepSegments(deleteRanges, totalDuration);

  const outputId = crypto.randomUUID();
  const outputFilename = `processed-${outputId}.${outputFormat}`;
  const outputPath = path.join(downloadDir, outputFilename);

  let command = ffmpeg(fileData.path);
  
  // 1. Cutting + Normalization Chaining
  let finalAudioStream = '0:a'; // Default to input stream if no cuts
  let filterComplex = '';

  if (keepSegments.length > 0 && deleteRanges.length > 0) {
    let inputs = '';
    keepSegments.forEach((seg, i) => {
      filterComplex += `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}];`;
      inputs += `[a${i}]`;
    });
    filterComplex += `${inputs}concat=n=${keepSegments.length}:v=0:a=1[cutout];`;
    finalAudioStream = 'cutout';
  } else if (deleteRanges.length >= totalDuration || keepSegments.length === 0) {
    return res.status(400).json({ success: false, error: 'All audio segments were deleted' });
  }

  // 2. Add Normalization to Complex Filter if already using it, else use simple filter
  const lufs = parseFloat(targetLufs);
  const peak = parseFloat(truePeak);
  const limit = Math.pow(10, peak / 20).toFixed(3);
  let normFilter = `loudnorm=I=${lufs}:TP=${peak}:LRA=11`;
  if (limiterEnabled === true || limiterEnabled === 'true') {
    normFilter += `,alimiter=limit=${limit}:attack=5:release=50`;
  }

  if (filterComplex) {
    filterComplex += `[${finalAudioStream}]${normFilter}[finalout]`;
    command.complexFilter(filterComplex).map('[finalout]');
  } else {
    command.audioFilter(normFilter);
  }

  // Encoding settings
  if (outputFormat === 'mp3') {
    command.toFormat('mp3').audioBitrate(bitrate || '192k');
  } else {
    command.toFormat('wav');
  }

  command
    .on('start', (cmdLine) => console.log('Spawned FFmpeg with command: ' + cmdLine))
    .on('end', () => {
      ffmpeg.ffprobe(outputPath, (err, metadata) => {
        const processedDuration = err ? 0 : parseFloat(metadata.format.duration);
        res.json({
          success: true,
          processedFileId: outputId,
          processedAudioUrl: `/downloads/${outputFilename}`,
          originalDuration: totalDuration,
          processedDuration,
          removedDuration: totalDuration - processedDuration
        });
      });
    })
    .on('error', (err) => {
      console.error('Audio processing FFmpeg error:', err);
      res.status(500).json({ success: false, error: 'Audio processing failed' });
    })
    .save(outputPath);
});

/**
 * Final Export Mapping
 */
app.post('/api/export', (req, res) => {
  const { processedFileId, outputFilename, outputFormat = 'mp3', quality = '보통' } = req.body;

  const files = fs.readdirSync(downloadDir);
  const sourceFile = files.find(f => f.includes(processedFileId));
  if (!sourceFile) return res.status(404).json({ success: false, error: 'Processed file not found' });

  // Filename sanitization (Korean supported)
  let safeName = outputFilename || sourceFile.replace('processed-', '').split('.')[0] + '_fixed';
  safeName = safeName.replace(/[^a-z0-9가-힣_\-]/gi, '_').substring(0, 255);
  const finalFilename = `${safeName}.${outputFormat}`;
  const finalPath = path.join(downloadDir, finalFilename);

  let command = ffmpeg(path.join(downloadDir, sourceFile));

  // Quality Mapping
  if (outputFormat === 'mp3') {
    const bitrates = { '낮음': '128k', '보통': '192k', '높음': '320k' };
    command.toFormat('mp3').audioBitrate(bitrates[quality] || '192k');
  } else {
    // WAV quality settings
    if (quality === '낮음') command.audioCodec('pcm_s16le').audioFrequency(44100);
    else if (quality === '보통') command.audioCodec('pcm_s24le').audioFrequency(44100);
    else if (quality === '높음') command.audioCodec('pcm_s24le').audioFrequency(48000);
    command.toFormat('wav');
  }

  command
    .on('end', () => res.json({ success: true, filename: finalFilename, downloadUrl: `/downloads/${finalFilename}` }))
    .on('error', (err) => res.status(500).json({ success: false, error: 'Export failed' }))
    .save(finalPath);
});

// Fallback for React Router (Single Page App)
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistDir, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
