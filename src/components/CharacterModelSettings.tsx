import { useState } from 'react';
import type { CharacterModelBridge } from '../types/character-models';

interface CharacterModelSettingsProps {
  modelId?: string | null;
  onImported: (modelId: string) => Promise<void> | void;
}

export function CharacterModelSettings({ modelId, onImported }: CharacterModelSettingsProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const importModel = async () => {
    const bridge = window.dotdock as (typeof window.dotdock & Partial<CharacterModelBridge>);
    if (!bridge?.importCharacterModel) {
      setMessage('데스크톱 앱에서 GLB 파일을 가져올 수 있습니다.');
      return;
    }
    setBusy(true);
    try {
      const result = await bridge.importCharacterModel();
      if (result.ok && result.modelId) await onImported(result.modelId);
      setMessage(result.message);
    } catch {
      setMessage('3D 모델을 선택하거나 설정을 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  return (
    <section className="provider-card">
      <div className="provider-header">
        <strong className="provider-name">내 3D 캐릭터</strong>
        <button type="button" className="mini-btn is-accent" disabled={busy}
          onClick={() => void importModel()}>{busy ? '가져오는 중…' : 'GLB 가져오기'}</button>
      </div>
      <p className="quota-reset-text">
        {modelId ? '가져온 GLB 모델을 사용할 수 있습니다. ' : 'Tripo 등에서 만든 GLB 파일을 선택하세요. '}
        파일 10MB · 삼각형 2만 개 · 내장 텍스처 2048px 이하를 지원합니다.
      </p>
      <p className="quota-reset-text">3D 캐릭터를 드래그하면 회전하고, 아래 이름표를 드래그하면 창을 이동합니다.</p>
      {message && <div className="sync-banner" role="status" aria-live="polite">{message}</div>}
    </section>
  );
}

export default CharacterModelSettings;
