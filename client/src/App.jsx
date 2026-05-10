import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { 
  Upload, Play, Pause, RotateCcw, ZoomIn, ZoomOut, Maximize, 
  Scissors, Trash2, Download, Settings, CheckCircle, AlertCircle, FileAudio,
  HelpCircle, Clock, Menu, Video, Camera, Sliders, Info
} from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.js';
import './App.css';

const TooltipInfo = ({ text }) => {
  const [show, setShow] = useState(false);
  return (
    <div 
      className="tooltip-wrapper"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(!show)}
    >
      <Info size={14} className="info-icon" />
      {show && <div className="tooltip-text">{text}</div>}
    </div>
  );
};

/**
 * CLEAN CUT AUDIO EDITOR - FRONTEND
 * Mockup-based 3-Column UI with Auto-Processing
 */

function App() {
  // --- STATE MANAGEMENT ---
  const [file, setFile] = useState(null);
  const [processedFile, setProcessedFile] = useState(null);
  const [processedFileId, setProcessedFileId] = useState(null);
  const [waveformReady, setWaveformReady] = useState(false);
  const [status, setStatus] = useState('준비 완료');
  const [statusType, setStatusType] = useState('ready');
  
  const [originalTime, setOriginalTime] = useState('00:00.000');
  const [originalDuration, setOriginalDuration] = useState('00:00.000');
  const [processedTime, setProcessedTime] = useState('00:00.000');
  const [processedDuration, setProcessedDuration] = useState('00:00.000');
  const [zoom, setZoom] = useState(0);
  const [zoomProcessed, setZoomProcessed] = useState(0);

  const [threshold, setThreshold] = useState(-40);
  const [minSilence, setMinSilence] = useState(0.5);
  const [padding, setPadding] = useState(0.15);
  const [selectedRange, setSelectedRange] = useState(null);
  const [preset, setPreset] = useState('youtube');
  const [targetLufs, setTargetLufs] = useState(-14);
  const [truePeak, setTruePeak] = useState(-1.0);
  const [limiterEnabled, setLimiterEnabled] = useState(true);

  const [exportName, setExportName] = useState('');
  const [exportFormat, setExportFormat] = useState('mp3');
  const [exportQuality, setExportQuality] = useState('보통');

  const [results, setResults] = useState({
    originalLength: '00:00.000',
    processedLength: '00:00.000',
    deletedTime: '00:00.000',
    deletedTimeSecs: 0,
    originalDurationSecs: 0,
    silenceCount: 0,
    manualCount: 0,
    silenceSegments: []
  });
  const [manualDeleteRanges, setManualDeleteRanges] = useState([]);

  const fileInputRef = useRef(null);
  const originalWaveformRef = useRef(null);
  const originalTimelineRef = useRef(null);
  const originalMinimapRef = useRef(null);
  
  const processedWaveformRef = useRef(null);
  const processedTimelineRef = useRef(null);
  const processedMinimapRef = useRef(null);
  
  const wsOriginal = useRef(null);
  const wsProcessed = useRef(null);

  // --- WAVEFORM INITIALIZATION ---
  useEffect(() => {
    if (file && originalWaveformRef.current) {
      if (wsOriginal.current) wsOriginal.current.destroy();
      setWaveformReady(false);

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
        minPxPerSec: 0,
        plugins: [
          RegionsPlugin.create(),
          TimelinePlugin.create({ container: originalTimelineRef.current, height: 20 }),
          MinimapPlugin.create({
            container: originalMinimapRef.current,
            height: 40,
            waveColor: '#cbd5e1',
            progressColor: '#93c5fd'
          })
        ]
      });

      setStatus('파형 불러오는 중...');
      setStatusType('busy');
      wsOriginal.current.load(file.url);
      
      wsOriginal.current.on('ready', () => {
        const durationSecs = wsOriginal.current.getDuration();
        const duration = formatTime(durationSecs);
        setOriginalDuration(duration);
        setResults(prev => ({ ...prev, originalLength: duration, originalDurationSecs: durationSecs }));
        setStatus('준비 완료');
        setStatusType('ready');
        setWaveformReady(true);
      });

      wsOriginal.current.on('audioprocess', () => setOriginalTime(formatTime(wsOriginal.current.getCurrentTime())));
      wsOriginal.current.on('interaction', () => setOriginalTime(formatTime(wsOriginal.current.getCurrentTime())));
      wsOriginal.current.on('play', () => setStatus('재생 중'));
      wsOriginal.current.on('pause', () => setStatus('준비 완료'));

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
    if (!processedWaveformRef.current) return;

    if (!wsProcessed.current) {
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
        minPxPerSec: 0,
        plugins: [
          TimelinePlugin.create({ container: processedTimelineRef.current, height: 20 }),
          MinimapPlugin.create({
            container: processedMinimapRef.current,
            height: 40,
            waveColor: '#cbd5e1',
            progressColor: '#6ee7b7'
          })
        ]
      });

      wsProcessed.current.on('ready', () => setProcessedDuration(formatTime(wsProcessed.current.getDuration())));
      wsProcessed.current.on('audioprocess', () => setProcessedTime(formatTime(wsProcessed.current.getCurrentTime())));
      wsProcessed.current.on('interaction', () => setProcessedTime(formatTime(wsProcessed.current.getCurrentTime())));
    }

    if (processedFile) {
      wsProcessed.current.load(processedFile.url);
    }
  }, [processedFile]);

  // Global cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsOriginal.current) wsOriginal.current.destroy();
      if (wsProcessed.current) wsProcessed.current.destroy();
    };
  }, []);

  // Combined detect + process in one pass (prevents flicker from chained state updates)
  const autoProcessRef = useRef(null);
  const latestRequestId = useRef(0);

  const detectAndProcess = async () => {
    if (!file) return;
    
    const currentRequestId = ++latestRequestId.current;
    setStatus('처리 중...');
    setStatusType('busy');

    try {
      // Step 1: Detect silence
      const detectRes = await axios.post('/api/detect-silence', {
        fileId: file.id, threshold, minSilence
      });
      if (latestRequestId.current !== currentRequestId) return; // Abort if newer request exists

      let silenceSegments = [];
      if (detectRes.data.success) {
        silenceSegments = detectRes.data.silenceSegments;
        const regions = wsOriginal.current?.plugins.find(p => p instanceof RegionsPlugin);
        if (regions) {
          regions.clearRegions();
          silenceSegments.forEach((seg, i) => regions.addRegion({
            id: `silence-${i}`, start: seg.start, end: seg.end,
            color: 'rgba(239, 68, 68, 0.3)', drag: false, resize: false
          }));
        }
        setResults(prev => ({ ...prev, silenceCount: silenceSegments.length, silenceSegments }));
      }

      // Step 2: Process audio (uses the segments we just detected)
      const processRes = await axios.post('/api/process', {
        fileId: file.id, silenceSegments, manualDeleteRanges: manualDeleteRanges,
        padding, targetLufs, truePeak, limiterEnabled, outputFormat: 'wav', bitrate: '192k'
      });
      if (latestRequestId.current !== currentRequestId) return; // Abort if newer request exists

      if (processRes.data.success) {
        const data = processRes.data;
        setResults(prev => ({
          ...prev,
          processedLength: formatTime(data.processedDuration),
          deletedTime: formatTime(data.removedDuration),
          deletedTimeSecs: data.removedDuration
        }));
        setProcessedFileId(data.processedFileId);
        setProcessedFile({ url: data.processedAudioUrl, duration: data.processedDuration });
      }

      setStatus('준비 완료');
      setStatusType('ready');
    } catch (error) {
      if (latestRequestId.current !== currentRequestId) return;
      console.error(error);
      setStatus('오류: ' + getKoreanError(error));
      setStatusType('error');
    }
  };

  // Single debounced useEffect for ALL setting changes
  useEffect(() => {
    if (!file || !waveformReady) return;
    if (autoProcessRef.current) clearTimeout(autoProcessRef.current);
    autoProcessRef.current = setTimeout(() => { detectAndProcess(); }, 400);
    return () => clearTimeout(autoProcessRef.current);
  }, [threshold, minSilence, padding, targetLufs, truePeak, limiterEnabled, preset, waveformReady, manualDeleteRanges]);

  // --- ACTIONS & HANDLERS ---
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const handleZoom = (direction, isProcessed = false) => {
    const ws = isProcessed ? wsProcessed.current : wsOriginal.current;
    if (!ws) return;
    
    const duration = ws.getDuration();
    const containerWidth = ws.getWrapper().clientWidth;
    const fitZoom = duration > 0 ? containerWidth / duration : 50;
    
    const currentZoom = isProcessed ? zoomProcessed : zoom;
    let actualCurrentZoom = currentZoom === 0 ? fitZoom : currentZoom;
    
    let newZoom;
    if (direction === 'in') {
      newZoom = actualCurrentZoom * 1.5;
    } else if (direction === 'out') {
      newZoom = actualCurrentZoom / 1.5;
      if (newZoom <= fitZoom * 1.05) newZoom = 0; // Snap to fit if zooming out close to fit
    } else {
      newZoom = 0; // reset
    }
    
    isProcessed ? setZoomProcessed(newZoom) : setZoom(newZoom);
    ws.zoom(newZoom);
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile || statusType === 'busy') return;
    setStatus('업로드 중...');
    setStatusType('busy');
    const formData = new FormData();
    formData.append('audio', uploadedFile);
    try {
      const response = await axios.post('/api/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (response.data.success) {
        const { fileId, originalFilename, uploadedFileUrl, duration } = response.data;
        setFile({ id: fileId, name: originalFilename, url: uploadedFileUrl, duration });
        setExportName(originalFilename.split('.')[0] + '_fixed');
        setStatus('업로드 완료');
        setStatusType('ready');
      }
    } catch (error) {
      setStatus('오류 발생: ' + getKoreanError(error));
      setStatusType('error');
    }
  };

  const handleManualDelete = async () => {
    if (!selectedRange || !file || statusType === 'busy') return;
    const updatedManualRanges = [...manualDeleteRanges, { ...selectedRange }];
    setManualDeleteRanges(updatedManualRanges);
    setResults(prev => ({ ...prev, manualCount: updatedManualRanges.length }));
    clearSelection();
  };

  const clearSelection = () => {
    if (!wsOriginal.current) { setSelectedRange(null); return; }
    const regions = wsOriginal.current.plugins.find(p => p instanceof RegionsPlugin);
    if (regions) regions.getRegions().forEach(r => { if (!r.id.startsWith('silence-')) r.remove(); });
    setSelectedRange(null);
  };

  const applyPreset = (p) => {
    setPreset(p);
    if (p === 'youtube') { setTargetLufs(-14); setTruePeak(-1.0); setLimiterEnabled(true); }
    else if (p === 'instagram') { setTargetLufs(-16); setTruePeak(-1.0); setLimiterEnabled(true); }
  };

  const getKoreanError = (error) => {
    const msg = error?.response?.data?.error || error?.message || '';
    if (msg.includes('No file uploaded')) return '파일을 선택해주세요.';
    if (msg.includes('Unsupported file format')) return '지원하지 않는 파일 형식입니다.';
    if (msg.includes('File too large')) return '파일 크기는 최대 100MB까지 가능합니다.';
    if (msg.includes('Corrupt or invalid audio file')) return '오디오 파일을 읽을 수 없습니다.';
    if (msg.includes('All audio segments were deleted')) return '구간이 너무 많아 오디오가 모두 삭제되었습니다.';
    return '오류가 발생했습니다. 다시 시도해주세요.';
  };

  const handleDownload = async () => {
    if (statusType === 'busy' || !file) return;

    // If not yet processed, run a process pass first
    if (!processedFileId) {
      setStatus('처리 중...');
      setStatusType('busy');
      try {
        const response = await axios.post('/api/process', {
          fileId: file.id, silenceSegments: results.silenceSegments, manualDeleteRanges: manualDeleteRanges,
          padding, targetLufs, truePeak, limiterEnabled, outputFormat: 'wav', bitrate: '192k'
        });
        if (!response.data.success) return;
        setProcessedFileId(response.data.processedFileId);
        // Continue to export with the new ID
        var exportFileId = response.data.processedFileId;
      } catch (error) {
        setStatus('오류: ' + getKoreanError(error));
        setStatusType('error');
        return;
      }
    }

    setStatus('내보내는 중...');
    setStatusType('busy');
    try {
      const response = await axios.post('/api/export', { processedFileId: exportFileId || processedFileId, outputFilename: exportName, outputFormat: exportFormat, quality: exportQuality });
      if (response.data.success) {
        setStatus('다운로드 완료');
        setStatusType('ready');
        const link = document.createElement('a');
        link.href = response.data.downloadUrl;
        link.download = response.data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      setStatus('오류: ' + getKoreanError(error));
      setStatusType('error');
    }
  };

  const calculatePercentage = () => {
    if (results.originalDurationSecs === 0) return '0.0%';
    return ((results.deletedTimeSecs / results.originalDurationSecs) * 100).toFixed(1) + '%';
  };

  // --- UI RENDER ---
  return (
    <div className="app-container">
      <header className="header">
        <div className="header-left">
          <div className="logo-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-9 5 18 3-9h3"/></svg>
          </div>
          <div className="header-title-group">
            <h1>오디오 클린컷 에디터</h1>
            <p>무음 구간을 제거하고, 음량을 정리한 뒤, 원하는 형식으로 내보내세요.</p>
          </div>
        </div>
      </header>

      <div className="grid-layout">
        {/* LEFT COLUMN */}
        <div className="col col-left">
          <div className="card">
            <h2 className="section-title"><Upload size={18} /> 1. 오디오 파일 업로드</h2>
            <div className="upload-zone" onClick={() => fileInputRef.current.click()}>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".mp3,.wav,.m4a,.aac" hidden />
              <Upload size={32} className="mx-auto text-primary opacity-50 mb-2" />
              <p>파일을 드래그 앤 드롭하거나</p>
              <button className="btn btn-primary" style={{padding:'0.4rem 1rem', fontSize:'0.85rem'}}>파일 선택</button>
              <div style={{fontSize:'0.75rem', color:'var(--text-muted)', marginTop:'1rem'}}>지원 형식: MP3, WAV, M4A, AAC</div>
              {file && <div className="file-info text-success">{file.name}</div>}
            </div>
          </div>

          <div className="card" style={{opacity: file ? 1 : 0.5, pointerEvents: file ? 'auto' : 'none'}}>
            <h2 className="section-title"><Scissors size={18} /> 3. 구간 삭제 (자동 & 수동)</h2>
            <div className="input-row">
              <label>무음 기준 볼륨 dB <TooltipInfo text="이 소리 크기보다 작으면 '잡음(무음)'으로 간주해서 지워버립니다. 숫자가 작을수록(-50에 가까울수록) 정말 작은 소리만 지우고, 클수록(-30에 가까울수록) 웬만한 소리도 다 지웁니다."/></label>
              <div className="input-with-unit">
                <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!file} />
                <span className="unit">dB</span>
              </div>
            </div>
            <div className="input-row">
              <label>최소 무음 길이 초 <TooltipInfo text="지정된 시간(예: 0.5초) 이상 연속으로 조용할 때만 무음으로 판단해 지웁니다. 너무 짧은 숨소리나 말 사이사이의 자연스러운 틈까지 다 잘려나가는 것을 막아줍니다."/></label>
              <div className="input-with-unit">
                <input type="number" step="0.1" value={minSilence} onChange={(e) => setMinSilence(e.target.value)} disabled={!file} />
                <span className="unit">초</span>
              </div>
            </div>
            <div className="input-row">
              <label>말 앞뒤 여백 초 <TooltipInfo text="말소리가 시작되기 직전과 끝난 직후에 약간의 여유(여백) 공간을 남겨둡니다. 여백이 0이면 말이 너무 뚝뚝 끊겨 로봇처럼 들릴 수 있습니다."/></label>
              <div className="input-with-unit">
                <input type="number" step="0.01" value={padding} onChange={(e) => setPadding(e.target.value)} disabled={!file} />
                <span className="unit">초</span>
              </div>
            </div>

            <div style={{height: '1px', background: 'var(--border)', margin: '1.5rem 0 1rem 0'}}></div>
            
            <p className="text-muted" style={{fontSize:'0.8rem', marginBottom:'1rem'}}>파형에서 드래그하여 수동으로 삭제할 구간을 지정할 수 있습니다.</p>
            <div className="input-row">
              <label style={{fontSize:'0.8rem'}}>선택 시작 시간</label>
              <input type="text" readOnly value={selectedRange ? formatTime(selectedRange.start) : '00:00:00.000'} style={{width:'130px', textAlign:'right'}} />
            </div>
            <div className="input-row">
              <label style={{fontSize:'0.8rem'}}>선택 종료 시간</label>
              <input type="text" readOnly value={selectedRange ? formatTime(selectedRange.end) : '00:00:00.000'} style={{width:'130px', textAlign:'right'}} />
            </div>
            <div style={{display:'flex', gap:'0.5rem', marginTop:'1rem'}}>
              <button className="btn btn-danger" style={{flex:1, justifyContent:'center'}} onClick={handleManualDelete} disabled={!selectedRange || statusType === 'busy' || !file}><Trash2 size={14} /> 선택 구간 삭제</button>
              <button className="btn btn-secondary" style={{flex:1, justifyContent:'center'}} onClick={clearSelection} disabled={!file}>선택 해제</button>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN */}
        <div className="col col-center">
          <div className="card">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem'}}>
              <h2 className="section-title" style={{margin:0}}>2. 원본 오디오 파형</h2>
              <div className="time-display" style={{margin:0}}>현재 시간 <span style={{fontWeight:'600', marginLeft:'4px', marginRight:'8px'}}>{originalTime}</span> / 전체 길이 <span style={{fontWeight:'600', marginLeft:'4px'}}>{originalDuration}</span></div>
            </div>
            
            <div ref={originalTimelineRef} className="timeline-view"></div>
            <div className="waveform-container">
              <div className="y-axis-guide">
                <span>0 dB</span><span>-6</span><span>-12</span><span>-18</span><span>-24</span><span>-30</span><span>-36</span><span>-∞</span>
              </div>
              <div ref={originalWaveformRef} className="waveform-view"></div>
              {!file && <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', fontSize:'0.85rem', pointerEvents:'none'}}>오디오 파일을 업로드하면 파형이 표시됩니다.</div>}
            </div>
            <div ref={originalMinimapRef} className="minimap-view"></div>
            
            <div className="waveform-controls mt-4">
              <button className="btn btn-primary" onClick={() => wsOriginal.current?.playPause()} disabled={!file}><Play size={16} /> 재생</button>
              <button className="btn btn-secondary" onClick={() => wsOriginal.current?.pause()} disabled={!file}><Pause size={16} /> 일시정지</button>
              <button className="btn btn-secondary" onClick={() => { wsOriginal.current?.stop(); wsOriginal.current?.seekTo(0); }} disabled={!file}><RotateCcw size={16} /> 처음으로</button>
              <button className="btn btn-secondary" onClick={() => handleZoom('in')} disabled={!file}><ZoomIn size={16} /> 확대</button>
              <button className="btn btn-secondary" onClick={() => handleZoom('out')} disabled={!file}><ZoomOut size={16} /> 축소</button>
              <button className="btn btn-secondary" onClick={() => handleZoom('reset')} disabled={!file}><RotateCcw size={16} /> 배율 초기화</button>
            </div>
          </div>

          <div className="card">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem'}}>
              <h2 className="section-title" style={{margin:0}}>5. 처리된 오디오 파형</h2>
              <div className="time-display" style={{margin:0}}>현재 시간 <span style={{fontWeight:'600', marginLeft:'4px', marginRight:'8px'}}>{processedTime}</span> / 전체 길이 <span style={{fontWeight:'600', marginLeft:'4px'}}>{processedDuration}</span></div>
            </div>
            
            <div ref={processedTimelineRef} className="timeline-view"></div>
            <div className="waveform-container" style={{borderColor: processedFile ? 'var(--success)' : 'var(--border)'}}>
              <div className="y-axis-guide">
                <span>0 dB</span><span>-6</span><span>-12</span><span>-18</span><span>-24</span><span>-30</span><span>-36</span><span>-∞</span>
              </div>
              <div ref={processedWaveformRef} className="waveform-view processed-view"></div>
              {!processedFile && <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', fontSize:'0.85rem', pointerEvents:'none'}}>처리가 완료되면 파형이 표시됩니다.</div>}
            </div>
            <div ref={processedMinimapRef} className="minimap-view"></div>

            <div className="waveform-controls mt-4">
              <button className="btn btn-primary" style={{background:'var(--success)', border:'none'}} onClick={() => wsProcessed.current?.playPause()} disabled={!processedFile}><Play size={16} /> 재생</button>
              <button className="btn btn-secondary" onClick={() => wsProcessed.current?.pause()} disabled={!processedFile}><Pause size={16} /> 일시정지</button>
              <button className="btn btn-secondary" onClick={() => { wsProcessed.current?.stop(); wsProcessed.current?.seekTo(0); }} disabled={!processedFile}><RotateCcw size={16} /> 처음으로</button>
              <button className="btn btn-secondary" onClick={() => handleZoom('in', true)} disabled={!processedFile}><ZoomIn size={16} /> 확대</button>
              <button className="btn btn-secondary" onClick={() => handleZoom('out', true)} disabled={!processedFile}><ZoomOut size={16} /> 축소</button>
              <button className="btn btn-secondary" onClick={() => handleZoom('reset', true)} disabled={!processedFile}><RotateCcw size={16} /> 배율 초기화</button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="col col-right" style={{opacity: file ? 1 : 0.5, pointerEvents: file ? 'auto' : 'none'}}>
            <div className="card">
              <h2 className="section-title"><Sliders size={18} /> 4. 음량 정리 프리셋</h2>
              <div className="preset-tabs">
                <div className={`preset-tab ${preset === 'youtube' ? 'active' : ''}`} onClick={() => applyPreset('youtube')}>
                  <Video size={20} color={preset==='youtube'?'#2563eb':'var(--text-muted)'} />
                  <span>유튜브 최적화</span>
                </div>
                <div className={`preset-tab ${preset === 'instagram' ? 'active' : ''}`} onClick={() => applyPreset('instagram')}>
                  <Camera size={20} color={preset==='instagram'?'#2563eb':'var(--text-muted)'} />
                  <span>인스타그램 최적화</span>
                </div>
                <div className={`preset-tab ${preset === 'custom' ? 'active' : ''}`} onClick={() => setPreset('custom')}>
                  <Sliders size={20} color={preset==='custom'?'#2563eb':'var(--text-muted)'} />
                  <span>직접 설정</span>
                </div>
              </div>
              <div className="input-row">
                <label>목표 음량 LUFS <TooltipInfo text="전체 영상의 평균 소리 크기(LUFS)를 맞춥니다. 유튜브는 보통 -14 LUFS가 가장 듣기 좋고 표준적인 크기입니다. 숫자가 클수록(-10 등) 전체 소리가 커집니다."/></label>
                <div className="input-with-unit">
                  <input type="number" value={targetLufs} onChange={(e) => setTargetLufs(e.target.value)} disabled={preset !== 'custom'} />
                  <span className="unit">LUFS</span>
                </div>
              </div>
              <div className="input-row">
                <label>트루피크 dB <TooltipInfo text="소리가 순간적으로 너무 커져서 스피커에서 찢어지거나 깨지는(Peak) 현상을 막아주는 최고 한계선입니다. 보통 -1.0dB로 설정하면 안전합니다."/></label>
                <div className="input-with-unit">
                  <input type="number" step="0.1" value={truePeak} onChange={(e) => setTruePeak(e.target.value)} disabled={preset !== 'custom'} />
                  <span className="unit">dB</span>
                </div>
              </div>
              <div className="input-row mt-2" style={{justifyContent: 'space-between', width: '100%'}}>
                <label>리미터 사용 <TooltipInfo text="소리가 지정된 트루피크 한계선을 넘으려고 할 때, 소리가 깨지지 않도록 부드럽게 꾹 눌러주는 보호 장치입니다. 무조건 켜두는 것을 권장합니다."/></label>
                <label className="toggle-switch">
                  <input type="checkbox" checked={limiterEnabled} onChange={(e) => setLimiterEnabled(e.target.checked)} disabled={preset !== 'custom'} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>

            <div className="card">
              <h2 className="section-title"><Download size={18} /> 6. 내보내기</h2>
              <div style={{marginBottom:'1rem'}}>
                <label style={{fontSize:'0.85rem', color:'var(--text)', display:'block', marginBottom:'0.3rem'}}>파일 이름</label>
                <input type="text" placeholder="파일명_fixed" value={exportName} onChange={(e) => setExportName(e.target.value)} />
              </div>
              
              <div style={{marginBottom:'1rem'}}>
                <label style={{fontSize:'0.85rem', color:'var(--text)', display:'block', marginBottom:'0.5rem'}}>출력 형식</label>
                <div className="radio-group">
                  <label><input type="radio" name="format" value="mp3" checked={exportFormat==='mp3'} onChange={(e)=>setExportFormat(e.target.value)} /> MP3</label>
                  <label><input type="radio" name="format" value="wav" checked={exportFormat==='wav'} onChange={(e)=>setExportFormat(e.target.value)} /> WAV</label>
                </div>
              </div>

              <div style={{marginBottom:'1.5rem'}}>
                <label style={{fontSize:'0.85rem', color:'var(--text)', display:'block', marginBottom:'0.3rem'}}>음질</label>
                <div className="quality-tabs">
                  <div className={`quality-tab ${exportQuality==='낮음'?'active':''}`} onClick={() => setExportQuality('낮음')}>
                    <span>낮음</span><span>128 kbps</span>
                  </div>
                  <div className={`quality-tab ${exportQuality==='보통'?'active':''}`} onClick={() => setExportQuality('보통')}>
                    <span>보통</span><span>192 kbps</span>
                  </div>
                  <div className={`quality-tab ${exportQuality==='높음'?'active':''}`} onClick={() => setExportQuality('높음')}>
                    <span>높음</span><span>320 kbps</span>
                  </div>
                </div>
              </div>

              <button className="btn btn-primary w-full justify-center" style={{padding:'0.8rem', fontSize:'1rem'}} onClick={handleDownload} disabled={statusType === 'busy'}><Download size={18} /> 최종 오디오 다운로드</button>
            </div>

            <div className="card">
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <h2 className="section-title" style={{margin:0}}><CheckCircle size={18} /> 7. 처리 상태</h2>
                <div className={`status-badge ${statusType}`}>
                  {status}
                </div>
              </div>

              <div className="status-list">
                <div className="status-row">
                  <div className="status-label-group"><div className="status-dot active"></div> 원본 길이</div>
                  <div className="status-value">{results.originalLength}</div>
                </div>
                <div className="status-row">
                  <div className="status-label-group"><div className="status-dot active"></div> 처리 후 길이</div>
                  <div className="status-value">{results.processedLength}</div>
                </div>
                <div className="status-row">
                  <div className="status-label-group"><div className="status-dot active"></div> 삭제된 시간</div>
                  <div className="status-value" style={{color:'var(--success)'}}>
                    {results.deletedTime} <span style={{fontSize:'0.75rem', fontWeight:'normal'}}>({calculatePercentage()})</span>
                  </div>
                </div>
                <div className="status-row">
                  <div className="status-label-group"><div className="status-dot active"></div> 감지된 무음 구간 수</div>
                  <div className="status-value">{results.silenceCount}</div>
                </div>
                <div className="status-row">
                  <div className="status-label-group"><div className="status-dot active"></div> 수동 삭제 구간 수</div>
                  <div className="status-value">{results.manualCount}</div>
                </div>
              </div>
            </div>
        </div>
      </div>

      <div className="footer-tip">
        <Info size={18} style={{flexShrink: 0, marginTop: '2px'}} />
        <span>팁: 파형에서 드래그하여 구간을 선택하면 수동 삭제가 더 정확하게 가능합니다. 마우스 휠로 확대/축소할 수 있습니다. 설정값을 변경하면 자동으로 결과에 반영됩니다.</span>
      </div>
    </div>
  );
}

export default App;
