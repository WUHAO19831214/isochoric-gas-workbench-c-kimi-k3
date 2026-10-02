/**
 * 摄像头适配层。
 * physics-software-sensors 的 camera.capture 是 Python 组件，无法直接运行在
 * 纯 Web 页面中；本适配层遵循其设计（帧 + 时间戳 + 设备元数据、权限错误显式分类），
 * 在浏览器内以 getUserMedia 实现同等能力。视频帧不做像素级处理，直接交 <video> 渲染。
 */

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
}

export interface CameraError {
  code: 'PERMISSION_DENIED' | 'NOT_FOUND' | 'IN_USE' | 'UNSUPPORTED' | 'UNKNOWN';
  message: string;
}

export async function listCameraDevices(): Promise<CameraDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `摄像头 ${i + 1}（未授权时不显示名称）` }));
}

export async function openCamera(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw cameraError('UNSUPPORTED', '当前浏览器不支持摄像头调用（getUserMedia），请使用 Chrome / Edge 并通过 localhost 或 HTTPS 访问。');
  }
  const constraints: MediaStreamConstraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : 'UnknownError';
    if (name === 'NotAllowedError') {
      throw cameraError('PERMISSION_DENIED', '摄像头权限被拒绝：请在浏览器地址栏的权限设置中允许摄像头后重试。');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw cameraError('NOT_FOUND', '未找到所选摄像头（可能已被拔出），请重新选择设备。');
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      throw cameraError('IN_USE', '摄像头被其他应用占用或暂时不可用，请关闭占用程序后重试。');
    }
    throw cameraError('UNKNOWN', `摄像头启动失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** 摄像头元数据（对应 camera.capture 的设备元数据 + 时间戳设计） */
export function cameraMetadata(stream: MediaStream): Record<string, string | number | null> {
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings() ?? {};
  return {
    device_label: track?.label ?? null,
    width: settings.width ?? null,
    height: settings.height ?? null,
    frame_rate: settings.frameRate ?? null,
    captured_at: new Date().toISOString(),
    backend: 'browser-get-user-media (camera.capture 的 Web 适配)',
  };
}

function cameraError(code: CameraError['code'], message: string): CameraError {
  return { code, message };
}

export function isCameraError(err: unknown): err is CameraError {
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err;
}
