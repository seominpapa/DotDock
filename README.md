# DotDock

12지신 캐릭터와 AI 사용량을 바탕화면에 표시하는 macOS·Windows 데스크톱 앱입니다.

## 다운로드 및 설치

[최신 릴리스와 설치 파일](https://github.com/seominpapa/DotDock/releases/latest)

| 컴퓨터 | 0.1.1 설치 파일 |
| --- | --- |
| Mac Apple Silicon (M 시리즈) | [DMG 다운로드](https://github.com/seominpapa/DotDock/releases/download/v0.1.1/DotDock-0.1.1-arm64.dmg) |
| Mac Intel | [DMG 다운로드](https://github.com/seominpapa/DotDock/releases/download/v0.1.1/DotDock-0.1.1-x64.dmg) |
| Windows 64비트 | [설치 EXE 다운로드](https://github.com/seominpapa/DotDock/releases/download/v0.1.1/DotDock-Setup-0.1.1-x64.exe) |

Mac은 DMG를 열어 DotDock을 응용 프로그램 폴더로 복사한 뒤 실행합니다. Windows는 Setup EXE를 실행하고 설치 안내를 따릅니다. 설치 파일은 개발자 인증서로 서명·공증하지 않았으므로 운영체제의 보안 경고가 표시될 수 있습니다. Windows ARM 네이티브 설치 파일은 제공하지 않습니다.

## 기능

- 12지신별 **벡터(SVG) / 도트(DOT)** 스타일 선택. 기본 64px부터 최대 1.5배(96px)까지 표시하며, 두 스타일 모두 SVG 원본을 사용합니다. 도트의 각진 윤곽은 의도된 표현입니다. 기존 설정은 도트 스타일로 유지됩니다.
- 생년으로 띠 자동 선택, 직접 캐릭터 선택, 사용자 PNG/GIF/WebP 이미지. 사용자 이미지 품질은 원본 해상도에 따라 달라집니다.
- Codex·Claude·Antigravity/Gemini 사용량 표시. 여러 체크박스를 선택하면 캐릭터 아래에 선택한 모든 항목의 잔여율과 막대를 표시합니다.
- 투명 창, 드래그 이동·위치 저장, 항상 위 표시, 트레이 최소화, 로그인 시 실행.
- 5·10·15·20분 AI 사용량 동기화, 로컬 JSON 연동, CPU·GPU·RAM 현황, 메모.
- 설정 → **시스템 · 창**에서 현재 버전과 업데이트 확인. 시작 시 새 버전이 있을 때 다운로드 여부를 묻는 알림(설정에서 끌 수 있음).

### 업데이트

GitHub의 최신 정식 릴리스를 조회하고 현재 OS·CPU에 맞는 설치 파일을 다운로드합니다. 파일 크기와 GitHub 릴리스의 SHA-256 값이 일치할 때만 엽니다. 오프라인이거나 검증에 실패하면 설치하지 않습니다.

**다운로드 및 설치**를 누른 뒤 DotDock을 종료하고 설치를 마무리하세요. Mac은 새 앱을 응용 프로그램 폴더에 덮어쓰고, Windows는 설치 프로그램의 안내를 따릅니다. 설정과 메모는 앱과 별도의 사용자 데이터 폴더에 보관됩니다. 앱 파일을 자동 교체하는 무인 업데이트 방식은 아닙니다.

### AI 계정 연결

- **Codex·Claude:** 웹 로그인 또는 기존 로컬 CLI 인증을 감지하여 사용량 조회를 시도합니다. 공급자 계정·요금제·API 응답에 따라 지원되는 항목만 표시합니다.
- **Antigravity/Gemini:** Antigravity에서 Google 계정으로 로그인한 뒤 DotDock의 **로컬 인증 감지**를 누릅니다. Gemini 모델과 Claude/GPT 모델 풀을 구분하며 각 풀에서 잔여율이 가장 낮은 모델을 표시합니다. 일반 Gemini 앱의 5시간/주간 한도를 뜻하지 않습니다.
- 공급자 API·인증 형식이 바뀌면 연동이 중단될 수 있습니다. 실제 개인 계정의 OAuth 성공 여부는 자동화 테스트에서 검증하지 않습니다.
- 자체 Google OAuth를 개발하는 경우 `DOTDOCK_GOOGLE_CLIENT_ID`, `DOTDOCK_GOOGLE_CLIENT_SECRET` 환경변수를 설정할 수 있습니다. 공개 배포본의 기본 Google 연결 UI는 로컬 인증 감지를 사용합니다. 로컬 인증에 갱신용 클라이언트 정보가 없으면 Antigravity에서 재인증해야 할 수 있습니다.

액세스·리프레시 토큰은 Electron `safeStorage`로 암호화합니다. 기존 평문 인증 파일은 보안 저장소를 사용할 수 있을 때 암호화 형식으로 이전하며, 실패하면 기존 파일을 보존합니다. 사용자 인증 파일·설정·빌드 산출물은 Git 저장소에 포함하지 않습니다.

### 선택형 3D 검토

Tripo로 만든 GLB 모델을 별도 스타일로 선택하고 회전시키는 확장이 가능합니다. 기본은 SVG/DOT로 유지하고, 3D 선택 시에만 모델과 렌더러를 로드하며 정지·최소화 시 렌더링을 멈추는 구성이 후보입니다. 이번 릴리스에는 3D 모델·뷰어가 포함되지 않습니다. 실제 모델의 품질·GPU 사용량은 아직 측정하지 않았고 유료 생성도 수행하지 않았습니다.

## 개발 및 검증

Node.js 22 이상을 권장합니다.

```bash
npm ci
npm run generate:assets
npm run typecheck
npm test
npm run test:coverage
npm run build:web
npm run test:electron
npm start
```

`test:electron`은 임시 사용자 프로필로 실제 Electron 앱을 실행합니다. 초기 설정, 12종의 두 스타일·1.5배 표시, 다중 사용량 선택, 메모·위치·설정 복원, 시스템 정보 응답, 로컬 파일 연동을 검사합니다. 실제 사용자 인증과 시작프로그램 설정은 건드리지 않습니다. GPU 수치는 조회 결과의 형식·범위를 검사하며 물리 장비별 정확도를 보장하지 않습니다.

```bash
npm run dist:mac
npm run dist:win
```

`.github/workflows/release.yml`은 macOS Apple Silicon·Intel과 Windows x64에서 소스 앱과 설치 파일에서 꺼내거나 설치한 앱을 실행 검증합니다. `v<package.json 버전>` 태그를 푸시하면 모든 작업이 성공한 뒤 설치 파일·SHA256SUMS를 GitHub Releases에 게시합니다. 실패 시 Actions의 검사 보고서와 스크린샷을 확인하세요. 실제 사용자 PC의 수동 설치·외부 계정 로그인·다양한 GPU 성능은 별도 검증이 필요합니다.

## 로컬 사용량 파일

`~/.dotdock/quota.json`을 갱신하면 앱이 약 4초 주기로 변경을 감지합니다. 공급자별 필요한 항목만 포함할 수 있습니다.

```json
{
  "codex": {
    "weekly": { "used": 48, "limit": 100, "unit": "%", "resetLabel": "4일 후 초기화", "hidden": false }
  },
  "claude": {
    "fiveHour": { "used": 62, "limit": 100, "unit": "%", "resetLabel": "1시간 후 초기화", "hidden": false }
  },
  "gemini": {
    "fiveHour": { "used": 22, "limit": 100, "unit": "%", "label": "Gemini 모델", "resetLabel": "동기화 대기", "hidden": false }
  }
}
```

화면은 `src/components/`, 위젯은 `src/widgets/`, 상태·사용량 계산은 `src/services/`, 창·인증·업데이트는 `electron/`에 있습니다. 새 위젯은 `src/widgets/registry.ts`에 등록합니다.
