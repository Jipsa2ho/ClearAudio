import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { 
  Upload, Play, Pause, RotateCcw, ZoomIn, ZoomOut, Maximize, 
  Scissors, Trash2, Download, Settings, CheckCircle, AlertCircle, FileAudio
} from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import './App.css';

/**
 * CLEAN CUT AUDIO EDITOR - FRONTEND
 * Modern single-page React UI for audio cleanup
 */

function App() {
  // --- STATE MANAGEMENT ---
  const [file, setFile] = useState(null);
  const [processedFile, setProcessedFile] = useState(null);
  const [processedFileId, setProcessedFileId] = useState(null);
  const [status, setStatus] = useState('준비 완료');
  const [statusType, setStatusType] = useState('ready'); // ready, busy, error
  
  // Time and visualization states
  const [originalTime, setOriginalTime] = useState('00:00');
  const [originalDuration, setOriginalDuration] = useState('00:00');
  const [processedTime, setProcessedTime] = useState('00:00');
  const [processedDuration, setProcessedDuration] = useState('00:00');
  const [zoom, setZoom] = useState(50);
  const [zoomProcessed, setZoomProcessed] = useState(50);

  // Settings states
  const [threshold, setThreshold] = useState(-40);
  const [minSilence, setMinSilence] = useState(0.5);
  const [padding, setPadding] = useState(0.15);
  const [selectedRange, setSelectedRange] = useState(null);
  const [preset, setPreset] = useState('youtube');
  const [targetLufs, setTargetLufs] = useState(-14);
  const [truePeak, setTruePeak] = useState(-1.0);
  const [limiterEnabled, setLimiterEnabled] = useState(true);

  // Export states
  const [exportName, setExportName] = useState('');
  const [exportFormat, setExportFormat] = useState('mp3');
  const [exportQuality, setExportQuality] = useState('보통');

  // Results tracking
  const [results, setResults] = useState({
    originalLength: '0:00',
    processedLength: '0:00',
    deletedTime: '0:00',
    silenceCount: 0,
    manualCount: 0,
    silenceSegments: [],
    manualDeleteRanges: []
  });

  const fileInputRef = useRef(null);
  const originalWaveformRef = useRef(null);
  const processedWaveformRef = useRef(null);
  const wsOriginal = useRef(null);
  const wsProcessed = useRef(null);

  // --- WAVEFORM INITIALIZATION ---

  useEffect(() => {
    if (file && originalWaveformRef.current) {
      if (wsOriginal.current) wsOriginal.current.destroy();

      wsOriginal.current = WaveSurfer.create({
        container: originalWaveformRef.current,
        waveColor: '#94a3b8',
        progressColor: '#2563eb',
        cursorColor: '#2563eb',
        cursorWidth: 2,
        height: 128,
        barWidth: 2,
        barGap: 2,
        barRadius: 3,
        responsive: true,
        minPxPerSec: 50,
        plugins: [RegionsPlugin.create()]
      });

      setStatus('파형 불러오는 중');
      setStatusType('busy');
      wsOriginal.current.load(file.url);
      
      wsOriginal.current.on('ready', () => {
        setStatus('준비 완료');
        setStatusType('ready');
        const duration = formatTime(wsOriginal.current.getDuration());
        setOriginalDuration(duration);
        setResults(prev => ({ ...prev, originalLength: duration }));
      });

      wsOriginal.current.on('audioprocess', () => setOriginalTime(formatTime(wsOriginal.current.getCurrentTime())));
      wsOriginal.current.on('interaction', () => setOriginalTime(formatTime(wsOriginal.current.getCurrentTime())));
      wsOriginal.current.on('play', () => setStatus('재생 중'));
      wsOriginal.current.on('pause', () => setStatus('준비 완료'));

      // Setup Regions Plugin for manual selection
      const regions = wsOriginal.current.plugins.find(p => p instanceof RegionsPlugin);
      if (regions) {
        regions.enableDragSelection({ color: 'rgba(59, 130, 246, 0.3)' });
        regions.on('region-created', (region) => {
          regions.getRegions().forEach(r => { if (r.id !== region.id && !r.id.startsWith('silence-')) r.remove(); });
          setSelectedRange({ start: region.start, end: region.end });
        });
        regions.on('region-updated', (region) => setSelectedRange({ start: region.start, end: region.end }));
      }

      return () => wsOriginal.current?.destroy();
    }
  }, [file]);

  useEffect(() => {
    if (processedFile && processedWaveformRef.current) {
      if (wsProcessed.current) wsProcessed.current.destroy();

      wsProcessed.current = WaveSurfer.create({
        container: processedWaveformRef.current,
        waveColor: '#94a3b8',
        progressColor: '#10b981',
        cursorColor: '#10b981',
        cursorWidth: 2,
        height: 128,
        barWidth: 2,
        barGap: 2,
        barRadius: 3,
        responsive: true,
        minPxPerSec: 50
      });

      wsProcessed.current.load(processedFile.url);
      wsProcessed.current.on('ready', () => setProcessedDuration(formatTime(wsProcessed.current.getDuration())));
      wsProcessed.current.on('audioprocess', () => setProcessedTime(formatTime(wsProcessed.current.getCurrentTime())));
      wsProcessed.current.on('interaction', () => setProcessedTime(formatTime(wsProcessed.current.getCurrentTime())));

      // Disable regions on processed waveform to avoid confusion
      return () => wsProcessed.current?.destroy();
    }
  }, [processedFile]);

  // --- AUTO PROCESSING LOGIC (DEBOUNCED) ---
  const detectSilenceRef = useRef(null);
  const processRef = useRef(null);

  useEffect(() => {
    if (!file) return;
    if (detectSilenceRef.current) clearTimeout(detectSilenceRef.current);
    detectSilenceRef.current = setTimeout(() => {
      detectSilence();
    }, 500);
    return () => clearTimeout(detectSilenceRef.current);
  }, [threshold, minSilence, file]);

  useEffect(() => {
    if (!file) return;
    if (statusType === 'busy' && status.includes('탐색')) return; // Wait for silence detection
    
    if (processRef.current) clearTimeout(processRef.current);
    processRef.current = setTimeout(() => {
      handleProcess();
    }, 500);
    return () => clearTimeout(processRef.current);
  }, [results.silenceSegments, results.manualDeleteRanges, padding, targetLufs, truePeak, limiterEnabled, preset, file]);

  // --- ACTIONS & HANDLERS ---

  const handleZoom = (direction, isProcessed = false) => {
    const ws = isProcessed ? wsProcessed.current : wsOriginal.current;
    if (!ws) return;
    const currentZoom = isProcessed ? zoomProcessed : zoom;
    let newZoom = direction === 'in' ? currentZoom * 1.5 : direction === 'out' ? currentZoom / 1.5 : 50;
    isProcessed ? setZoomProcessed(newZoom) : setZoom(newZoom);
    ws.zoom(newZoom);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getKoreanError = (error) => {
    const msg = error?.response?.data?.error || error?.message || '';
    if (msg.includes('No file uploaded')) return '파일을 선택해주세요.';
    if (msg.includes('Unsupported file format')) return '지원하지 않는 파일 형식입니다.';
    if (msg.includes('File too large')) return '파일 크기는 최대 100MB까지 가능합니다.';
    if (msg.includes('Corrupt or invalid audio file')) return '오디오 파일을 읽을 수 없습니다.';
    if (msg.includes('Invalid silence threshold')) return '무음 기준값이 올바르지 않습니다.';
    if (msg.includes('Invalid min silence duration')) return '최소 무음 길이가 올바르지 않습니다.';
    if (msg.includes('Invalid padding value')) return '여백 값이 올바르지 않습니다.';
    if (msg.includes('Invalid target LUFS')) return '목표 음량 LUFS 값이 올바르지 않습니다.';
    if (msg.includes('Invalid true peak')) return '트루피크 dB 값이 올바르지 않습니다.';
    if (msg.includes('All audio segments were deleted')) return '구간이 너무 많아 오디오가 모두 삭제되었습니다.';
    return '오류가 발생했습니다. 다시 시도해주세요.';
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile || statusType === 'busy') return;

    setStatus('업로드 중');
    setStatusType('busy');

    const formData = new FormData();
    formData.append('audio', uploadedFile);

    try {
      const response = await axios.post('/api/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (response.data.success) {
        const { fileId, originalFilename, uploadedFileUrl, duration } = response.data;
        setFile({ id: fileId, name: originalFilename, url: uploadedFileUrl, duration });
        setExportName(originalFilename.split('.')[0]);
        setStatus('업로드 완료');
        setStatusType('ready');
      }
    } catch (error) {
      setStatus('오류 발생: ' + getKoreanError(error));
      setStatusType('error');
    }
  };

  const detectSilence = async () => {
    if (!file || statusType === 'busy') return;
    setStatus('무음 구간 탐색 중');
    setStatusType('busy');

    try {
      const response = await axios.post('/api/detect-silence', { fileId: file.id, silenceThreshold: threshold, minSilenceDuration: minSilence });
      if (response.data.success) {
        const segments = response.data.silenceSegments;
        if (segments.length === 0) {
          setStatus('감지된 무음 구간이 없습니다');
          setStatusType('ready');
        } else {
          const regions = wsOriginal.current.plugins.find(p => p instanceof RegionsPlugin);
          if (regions) {
            regions.clearRegions();
            segments.forEach((seg, i) => regions.addRegion({ id: `silence-${i}`, start: seg.start, end: seg.end, color: 'rgba(239, 68, 68, 0.3)', drag: false, resize: false }));
          }
          setStatus('무음 구간 탐색 완료');
          setStatusType('ready');
          setResults(prev => ({ ...prev, silenceCount: segments.length, silenceSegments: segments }));
        }
      }
    } catch (error) {
      setStatus('오류 발생: ' + getKoreanError(error));
      setStatusType('error');
    }
  };

  const handleProcess = async (isDownload = false) => {
    if (!file || statusType === 'busy') return;
    setStatus(isDownload ? '내보내는 중' : '오디오 처리 중');
    setStatusType('busy');

    try {
      const response = await axios.post('/api/process', {
        fileId: file.id, silenceSegments: results.silenceSegments, manualDeleteRanges: results.manualDeleteRanges,
        padding, targetLufs, truePeak, limiterEnabled, outputFormat: isDownload ? exportFormat : 'wav', bitrate: '192k'
      });

      if (response.data.success) {
        const data = response.data;
        setResults(prev => ({ ...prev, processedLength: formatTime(data.processedDuration), deletedTime: formatTime(data.removedDuration) }));
        setProcessedFileId(data.processedFileId);
        setStatus(isDownload ? '완료' : '자동 처리 완료');
        setStatusType('ready');

        if (!isDownload) {
          setProcessedFile({ url: data.processedAudioUrl, duration: data.processedDuration });
        }
        return data.processedAudioUrl;
      }
    } catch (error) {
      if (!isDownload) {
        setStatus('자동 처리 오류');
      } else {
        setStatus('오류 발생: ' + getKoreanError(error));
      }
      setStatusType('error');
    }
  };

  const handleManualDelete = async () => {
    if (!selectedRange || !file || statusType === 'busy') return;
    const updatedManualRanges = [...results.manualDeleteRanges, { ...selectedRange }];
    setResults(prev => ({ ...prev, manualCount: updatedManualRanges.length, manualDeleteRanges: updatedManualRanges }));
    clearSelection();
    // handleProcess will be triggered automatically by the useEffect watching results.manualDeleteRanges
  };

  const clearSelection = () => {
    const regions = wsOriginal.current.plugins.find(p => p instanceof RegionsPlugin);
    if (regions) regions.getRegions().forEach(r => { if (!r.id.startsWith('silence-')) r.remove(); });
    setSelectedRange(null);
  };

  const applyPreset = (p) => {
    setPreset(p);
    if (p === 'youtube') { setTargetLufs(-14); setTruePeak(-1.0); setLimiterEnabled(true); }
    else if (p === 'instagram') { setTargetLufs(-16); setTruePeak(-1.0); setLimiterEnabled(true); }
  };

  const handleDownload = async () => {
    if (statusType === 'busy') return;
    if (!processedFileId) {
      const previewUrl = await handleProcess(false);
      if (!previewUrl) return;
    }

    setStatus('내보내는 중');
    setStatusType('busy');
    try {
      const response = await axios.post('/api/export', { processedFileId, outputFilename: exportName, outputFormat: exportFormat, quality: exportQuality });
      if (response.data.success) {
        setStatus('완료');
        setStatusType('ready');
        const link = document.createElement('a');
        link.href = response.data.downloadUrl;
        link.download = response.data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      setStatus('오류 발생: ' + getKoreanError(error));
      setStatusType('error');
    }
  };

  // --- UI RENDER ---

  return (
    <div className="app-container">
      <header>
        <h1>오디오 클린컷 에디터</h1>
        <p>무음 구간을 제거하고, 음량을 정리한 뒤, 원하는 형식으로 내보내세요.</p>
      </header>

      <div className="card">
        <h2 className="section-title"><Upload size={20} /> 오디오 파일 업로드</h2>
        <div className="upload-zone" onClick={() => fileInputRef.current.click()}>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".mp3,.wav,.m4a,.aac" hidden />
          <FileAudio size={48} className="mx-auto text-primary opacity-50" />
          <div className="file-info">{file ? file.name : "파일을 선택하거나 이리로 끌어다 놓으세요"}</div>
          <p>지원 형식: MP3, WAV, M4A, AAC (최대 100MB)</p>
        </div>
      </div>

      {file && (
        <>
          <div className="card">
            <h2 className="section-title"><Play size={20} /> 원본 오디오</h2>
            <div className="waveform-container">
              <div ref={originalWaveformRef} className="waveform-view"></div>
              <div className="time-display"><span>{originalTime}</span><span>{originalDuration}</span></div>
            </div>
            <div className="waveform-controls">
              <button className="btn btn-secondary" onClick={() => wsOriginal.current?.playPause()}><Play size={16} /> <span className="btn-text">재생</span></button>
              <button className="btn btn-secondary" onClick={() => wsOriginal.current?.pause()}><Pause size={16} /> <span className="btn-text">정지</span></button>
              <button className="btn btn-secondary" onClick={() => { wsOriginal.current?.stop(); wsOriginal.current?.seekTo(0); }}><RotateCcw size={16} /> <span className="btn-text">처음</span></button>
              <button className="btn btn-secondary" onClick={() => handleZoom('in')}><ZoomIn size={16} /></button>
              <button className="btn btn-secondary" onClick={() => handleZoom('out')}><ZoomOut size={16} /></button>
              <button className="btn btn-secondary" onClick={() => handleZoom('reset')}><Maximize size={16} /></button>
              
              {selectedRange && (
                <>
                  <div style={{width: '1px', height: '20px', background: 'var(--border)', margin: '0 0.5rem'}}></div>
                  <button className="btn btn-danger" onClick={handleManualDelete} disabled={statusType === 'busy'}><Trash2 size={16} /> <span className="btn-text">선택 삭제</span></button>
                  <button className="btn btn-secondary" onClick={clearSelection}><span className="btn-text">취소</span></button>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="section-title"><Settings size={20} /> 편집 설정 (자동 적용)</h2>
            <div className="preset-tabs">
              <div className={`preset-tab ${preset === 'youtube' ? 'active' : ''}`} onClick={() => applyPreset('youtube')}>유튜브</div>
              <div className={`preset-tab ${preset === 'instagram' ? 'active' : ''}`} onClick={() => applyPreset('instagram')}>인스타그램</div>
              <div className={`preset-tab ${preset === 'custom' ? 'active' : ''}`} onClick={() => setPreset('custom')}>직접 설정</div>
            </div>
            <div className="input-grid">
              <div className="input-group"><label>무음 기준 dB</label><input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
              <div className="input-group"><label>최소 무음 (초)</label><input type="number" step="0.1" value={minSilence} onChange={(e) => setMinSilence(e.target.value)} /></div>
              <div className="input-group"><label>여백 (초)</label><input type="number" step="0.01" value={padding} onChange={(e) => setPadding(e.target.value)} /></div>
              <div className="input-group"><label>목표 LUFS</label><input type="number" value={targetLufs} onChange={(e) => setTargetLufs(e.target.value)} disabled={preset !== 'custom'} /></div>
              <div className="input-group"><label>트루피크 dB</label><input type="number" step="0.1" value={truePeak} onChange={(e) => setTruePeak(e.target.value)} disabled={preset !== 'custom'} /></div>
              <div className="input-group flex-row items-center gap-2" style={{flexDirection: 'row', paddingTop: '1.2rem'}}><input type="checkbox" checked={limiterEnabled} onChange={(e) => setLimiterEnabled(e.target.checked)} disabled={preset !== 'custom'} /><label>리미터</label></div>
            </div>
            <p className="text-muted text-sm" style={{fontSize: '0.8rem', marginTop: '0.5rem'}}>💡 원본 파형에서 삭제할 구간을 드래그하면 수동 삭제 버튼이 나타납니다. 설정값 변경 시 자동으로 처리됩니다.</p>
          </div>

          <div className="card">
            <h2 className="section-title"><Play size={20} /> 처리 완료 오디오</h2>
            <div className="waveform-container">
              <div ref={processedWaveformRef} className="waveform-view processed-view"></div>
              <div className="time-display"><span>{processedTime}</span><span>{processedDuration}</span></div>
            </div>
            <div className="waveform-controls">
              <button className="btn btn-secondary" onClick={() => wsProcessed.current?.playPause()}><Play size={16} /> <span className="btn-text">재생</span></button>
              <button className="btn btn-secondary" onClick={() => wsProcessed.current?.pause()}><Pause size={16} /> <span className="btn-text">정지</span></button>
              <button className="btn btn-secondary" onClick={() => { wsProcessed.current?.stop(); wsProcessed.current?.seekTo(0); }}><RotateCcw size={16} /> <span className="btn-text">처음</span></button>
              <button className="btn btn-secondary" onClick={() => handleZoom('in', true)}><ZoomIn size={16} /></button>
              <button className="btn btn-secondary" onClick={() => handleZoom('out', true)}><ZoomOut size={16} /></button>
              <button className="btn btn-secondary" onClick={() => handleZoom('reset', true)}><Maximize size={16} /></button>
            </div>
          </div>

          <div className="card">
            <h2 className="section-title"><Download size={20} /> 내보내기</h2>
            <div className="input-grid">
              <div className="input-group"><label>파일 이름</label><input type="text" placeholder="파일명_fixed" value={exportName} onChange={(e) => setExportName(e.target.value)} /></div>
              <div className="input-group"><label>출력 형식</label><select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}><option value="mp3">MP3</option><option value="wav">WAV</option></select></div>
              <div className="input-group"><label>음질</label><select value={exportQuality} onChange={(e) => setExportQuality(e.target.value)}><option value="낮음">낮음</option><option value="보통">보통</option><option value="높음">높음</option></select></div>
            </div>
            <button className="btn btn-primary w-full justify-center h-12 text-lg mt-4" onClick={handleDownload} disabled={statusType === 'busy'}><Download size={20} /> 최종 오디오 다운로드</button>
          </div>

          <div className="card">
            <h2 className="section-title"><CheckCircle size={20} /> 처리 상태</h2>
            <div className={`status-badge status-${statusType}`}>
              {statusType === 'ready' && <CheckCircle size={14} className="inline mr-1" />}
              {statusType === 'busy' && <div className="animate-spin inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full mr-1" />}
              {statusType === 'error' && <AlertCircle size={14} className="inline mr-1" />}
              {status}
            </div>
            <div className="results-grid">
              <div className="result-item"><div className="result-label">원본 길이</div><div className="result-value">{results.originalLength}</div></div>
              <div className="result-item"><div className="result-label">처리 후 길이</div><div className="result-value">{results.processedLength}</div></div>
              <div className="result-item"><div className="result-label">삭제된 시간</div><div className="result-value text-danger">{results.deletedTime}</div></div>
              <div className="result-item"><div className="result-label">감지된 무음 구간</div><div className="result-value">{results.silenceCount}개</div></div>
              <div className="result-item"><div className="result-label">수동 삭제 구간</div><div className="result-value">{results.manualCount}개</div></div>
            </div>
          </div>
        </>
      )}

      <footer className="text-center py-8 text-text-muted text-sm">
        <p>© 2026 오디오 클린컷 에디터 - CleanCut Audio Editor</p>
      </footer>
    </div>
  );
}

export default App;
