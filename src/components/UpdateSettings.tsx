import { useEffect, useState } from 'react';
import type { AppUpdateInfo } from '../types/dotdock';
import { checkForUpdates, getUpdateInfo, installUpdate } from '../services/storage';

export function UpdateSettings({ checkOnStartup, onToggleStartup }: {
  checkOnStartup: boolean;
  onToggleStartup: () => void;
}) {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void getUpdateInfo().then(setInfo).catch(() => setMessage('버전 정보를 불러오지 못했습니다.'));
  }, []);

  const run = async (install = false) => {
    setBusy(true);
    setMessage(install ? '설치 파일 다운로드 및 무결성 검사 중…' : '새 버전 확인 중…');
    try {
      if (install) {
        const result = await installUpdate();
        setMessage(result.message);
      } else {
        const result = await checkForUpdates();
        setInfo(result);
        setMessage(result.message);
      }
    } catch {
      setMessage('업데이트 작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="앱 버전 및 업데이트">
      <div className="settings-option-row">
        <span>현재 버전 <strong>{info?.currentVersion || '확인 중…'}</strong></span>
        <button type="button" className="mini-btn is-accent" disabled={busy} onClick={() => void run()}>
          업데이트 확인
        </button>
      </div>
      {info?.available && info.downloadAvailable && (
        <div className="settings-option-row">
          <span>새 버전 {info.latestVersion}</span>
          <button type="button" className="mini-btn is-accent" disabled={busy} onClick={() => void run(true)}>
            다운로드 및 설치
          </button>
        </div>
      )}
      <div className="settings-option-row">
        <span>시작할 때 업데이트 알림</span>
        <button type="button" className={`mini-btn ${checkOnStartup ? 'is-active' : ''}`}
          aria-pressed={checkOnStartup} onClick={onToggleStartup}>
          {checkOnStartup ? '켜짐 (ON)' : '꺼짐 (OFF)'}
        </button>
      </div>
      <p className="ext-guide-text" role="status">{message || info?.message}</p>
      <p className="ext-guide-text">설치 파일을 열면 앱을 종료한 뒤 설치해 주세요. Mac은 응용 프로그램 폴더에 덮어쓰고, Windows는 설치 안내를 따르면 됩니다.</p>
    </section>
  );
}
