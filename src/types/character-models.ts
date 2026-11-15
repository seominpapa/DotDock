export interface CharacterModelImportResult {
  ok: boolean;
  canceled?: boolean;
  modelId?: string;
  name?: string;
  message: string;
}

export interface CharacterModelLoadResult {
  ok: boolean;
  modelId?: string;
  base64?: string;
  message?: string;
}

export interface CharacterModelBridge {
  importCharacterModel: () => Promise<CharacterModelImportResult>;
  getCharacterModel: (modelId: string) => Promise<CharacterModelLoadResult>;
}
