/**
 * 中栏：真实实验摄像头。
 * 让学生始终看到"真实装置正在发生什么"；UI 尽量克制。
 * 使用 camera.capture 的 Web 适配层（getUserMedia + 设备元数据）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listCameraDevices, openCamera, stopCamera, cameraMetadata, isCameraError, type CameraDeviceInfo } from '../camera/cameraCapture';
import { useExperiment } from '../state/ExperimentContext';
import { formatElapsed } from './ExperimentControls';

export function CameraPanel() {
  const { state } = useExperiment();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<CameraDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [live, setLive] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [error, setError] = useState('');
  const [mirrored, setMirrored] = useState(false);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await listCameraDevices());
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const onChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, [refreshDevices]);

  const start = async () => {
    setError('');
    try {
      const stream = await openCamera(deviceId || undefined);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const meta = cameraMetadata(stream);
      setDeviceLabel(String(meta.device_label ?? '摄像头'));
      setLive(true);
      // 授权后设备名称才可见，刷新列表
      void refreshDevices();
      // 摄像头被拔出/占用中断时给出提示，但不影响其他区域
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setLive(false);
        setError('摄像头画面中断（设备被拔出或被其他应用占用）。');
      });
    } catch (err) {
      setLive(false);
      setError(isCameraError(err) ? err.message : `摄像头启动失败：${String(err)}`);
    }
  };

  const stop = () => {
    stopCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
  };

  useEffect(() => () => stopCamera(streamRef.current), []);

  return (
    <section className="panel panel-fill">
      <div className="panel-title">
        <span>实验现场</span>
        {live && <span className="lamp lamp-live">LIVE · {deviceLabel}</span>}
      </div>
      <div className="video-box">
        <video ref={videoRef} className="video" muted playsInline style={mirrored ? { transform: 'scaleX(-1)' } : undefined} />
        {!live && <div className="video-placeholder">选择摄像头并开启，实时显示实验装置</div>}
        {live && state.expState === 'REPLAYING' && <div className="video-replay-note">实验数据回放中</div>}
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="btn-row">
        <select className="num-input device-select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          <option value="">默认摄像头</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        {live ? (
          <button className="btn" onClick={stop}>关闭摄像头</button>
        ) : (
          <button className="btn btn-primary" onClick={() => void start()}>开启摄像头</button>
        )}
        <button className="btn btn-subtle" onClick={() => setMirrored((m) => !m)}>
          镜像
        </button>
        <button
          className="btn btn-subtle"
          onClick={() => {
            const el = videoRef.current;
            if (!el) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen?.();
          }}
        >
          全屏
        </button>
      </div>
      <div className="meta-text center-text">实验计时 {formatElapsed(state.elapsedSec)}</div>
    </section>
  );
}
