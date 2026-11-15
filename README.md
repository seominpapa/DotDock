# DotDock

12지신 캐릭터와 AI 사용량을 바탕화면에 표시하는 macOS·Windows 데스크톱 앱입니다.

## 다운로드 및 설치

[최신 릴리스와 설치 파일](https://github.com/seominpapa/DotDock/releases/latest)

| 컴퓨터 | 0.1.5 설치 파일 |
| --- | --- |
| Mac Apple Silicon (M 시리즈) | [DMG 다운로드](https://github.com/seominpapa/DotDock/releases/download/v0.1.5/DotDock-0.1.5-arm64.dmg) |
| Mac Intel | [DMG 다운로드](https://github.com/seominpapa/DotDock/releases/download/v0.1.5/DotDock-0.1.5-x64.dmg) |
| Windows 64비트 | [설치 EXE 다운로드](https://github.com/seominpapa/DotDock/releases/download/v0.1.5/DotDock-Setup-0.1.5-x64.exe) |

Mac은 DMG를 열어 DotDock을 응용 프로그램 폴더로 복사한 뒤 실행합니다. Windows는 Setup EXE를 실행하고 설치 안내를 따릅니다. 설치 파일은 개발자 인증서로 서명·공증하지 않았으므로 운영체제의 보안 경고가 표시될 수 있습니다. Windows ARM 네이티브 설치 파일은 제공하지 않습니다.

### 비서명 앱 보안 경고가 표시될 때

아래 안내는 이 저장소의 공식 릴리스에서 받은 DotDock에만 적용하세요.

**Windows 10 / 11**

1. `DotDock-Setup-0.1.5-x64.exe`를 다운로드해 실행합니다.
2. **Windows의 PC 보호** 경고가 나타나면 **추가 정보 → 실행**을 누릅니다.
3. 설치 마법사를 완료하면 바탕화면과 시작 메뉴에 바로가기가 생성됩니다.

**macOS**

1. 컴퓨터에 맞는 `DotDock-0.1.5-arm64.dmg` 또는 `DotDock-0.1.5-x64.dmg`를 열고 `DotDock.app`을 **Applications(응용 프로그램)** 폴더로 복사합니다.
2. 실행이 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 확인 없이 열기**를 선택합니다. 앱을 한 번 실행해 차단 안내를 확인한 뒤 이용하세요.
3. 계속 차단되는 경우 터미널에서 아래 명령어로 DotDock의 다운로드 격리 속성만 해제한 뒤 다시 실행합니다.

```bash
xattr -dr com.apple.quarantine /Applications/DotDock.app
```

파일이 실제로 손상된 경우에는 설치 파일을 다시 다운로드하세요. **로그인 시 자동 실행**은 기본으로 켜져 있으며, DotDock 설정 또는 트레이 아이콘 우클릭 메뉴에서 끌 수 있습니다.

## 기능

- 12지신별 **벡터(SVG) / 도트(DOT)** 스타일 선택. 기본 64px부터 최대 1.5배(96px)까지 표시하며, 두 스타일 모두 SVG 원본을 사용합니다. DOT는 64×64 세부 도안으로 다시 그렸으며, 16×16 원본을 단순 확대하지 않습니다. 도트의 각진 윤곽은 의도된 표현입니다. 기존 설정은 도트 스타일로 유지됩니다.
- 선택형 **3D** 스타일과 회전. Tripo로 생성한 12지신 GLB를 포함하며 사용자 GLB로 바꿀 수도 있습니다.
- 생년으로 띠 자동 선택, 직접 캐릭터 선택, 사용자 PNG/GIF/WebP 이미지. 사용자 이미지 품질은 원본 해상도에 따라 달라집니다.
- Codex·Claude·Antigravity/Gemini 사용량 표시. 여러 체크박스를 선택하면 캐릭터 아래에 선택한 모든 항목의 잔여율과 막대를 표시합니다.
- 투명 창, 드래그 이동·위치 저장, 항상 위 표시, 트레이 최소화, 로그인 시 실행.
- 5·10·15·20분 AI 사용량 동기화, 로컬 JSON 연동, CPU·GPU·RAM 현황, 메모.
- 설정 → **시스템 · 창**에서 현재 버전과 업데이트 확인. 시작 시 새 버전이 있을 때 다운로드 여부를 묻는 알림(설정에서 끌 수 있음).

### 나이는 80%만! (Joke)

캐릭터 아래 이름은 `96년생 쥐띠(24세)`처럼 표시합니다. 괄호 안 숫자는 **생일 기준 만 나이 × 0.8을 반올림한 ‘기분 나이’**입니다. “요즘은 실제 나이의 80%라고 생각하며 살자”는 가벼운 농담이며, 공식적인 나이를 뜻하지 않습니다. 예를 들어 만 30세라면 기분 나이는 24세입니다.

생일은 초기 설정이나 캐릭터 설정에서 입력할 수 있습니다. 생일을 입력하지 않으면 기존처럼 출생연도와 띠만 표시하며, 나이 괄호는 생략합니다. 생일을 입력하면 정확한 만 나이 기준으로 괄호가 표시됩니다. 생일 정보는 앱의 로컬 설정에 저장됩니다.

### 업데이트

GitHub의 최신 정식 릴리스를 조회하고 현재 OS·CPU에 맞는 설치 파일을 다운로드합니다. 파일 크기와 GitHub 릴리스의 SHA-256 값이 일치할 때만 엽니다. 오프라인이거나 검증에 실패하면 설치하지 않습니다.

**다운로드 및 설치**를 누른 뒤 DotDock을 종료하고 설치를 마무리하세요. Mac은 새 앱을 응용 프로그램 폴더에 덮어쓰고, Windows는 설치 프로그램의 안내를 따릅니다. 설정과 메모는 앱과 별도의 사용자 데이터 폴더에 보관됩니다. 앱 파일을 자동 교체하는 무인 업데이트 방식은 아닙니다.

### AI 계정 연결

- **Codex·Claude:** 웹 로그인 또는 기존 로컬 CLI 인증을 감지하여 사용량 조회를 시도합니다. 공급자 계정·요금제·API 응답에 따라 지원되는 항목만 표시합니다.
- **Antigravity/Gemini:** Antigravity에서 Google 계정으로 로그인한 뒤 DotDock의 **로컬 인증 감지**를 누릅니다. Gemini 모델과 Claude/GPT 모델 풀을 구분하며 각 풀에서 잔여율이 가장 낮은 모델을 표시합니다. 일반 Gemini 앱의 5시간/주간 한도를 뜻하지 않습니다.
- 공급자 API·인증 형식이 바뀌면 연동이 중단될 수 있습니다. 실제 개인 계정의 OAuth 성공 여부는 자동화 테스트에서 검증하지 않습니다.
- 자체 Google OAuth를 개발하는 경우 `DOTDOCK_GOOGLE_CLIENT_ID`, `DOTDOCK_GOOGLE_CLIENT_SECRET` 환경변수를 설정할 수 있습니다. 공개 배포본의 기본 Google 연결 UI는 로컬 인증 감지를 사용합니다. 로컬 인증에 갱신용 클라이언트 정보가 없으면 Antigravity에서 재인증해야 할 수 있습니다.

액세스·리프레시 토큰은 Electron `safeStorage`로 암호화합니다. 기존 평문 인증 파일은 보안 저장소를 사용할 수 있을 때 암호화 형식으로 이전하며, 실패하면 기존 파일을 보존합니다. 사용자 인증 파일·설정·빌드 산출물은 Git 저장소에 포함하지 않습니다.

### 선택형 3D 캐릭터

캐릭터 설정에서 **벡터 / 도트 / 3D**를 선택합니다. 3D 캐릭터를 드래그하면 회전하며, 아래 이름 영역을 드래그하면 기존처럼 창을 옮길 수 있습니다. 자동 회전이나 캐릭터 애니메이션은 사용하지 않습니다.

**3D를 선택하면 해당 캐릭터의 모델을 GitHub에서 자동 다운로드**합니다. 파일 크기와 SHA-256을 확인해 로컬에 캐시하며, 다시 선택하면 캐시를 사용합니다. 인터넷에 연결되지 않거나 다운로드에 실패하면 앱에 포함된 기본 모델로 표시합니다. 별도 ZIP을 설치할 필요는 없습니다.

12종을 파일로 받고 싶다면 [3D 모델 ZIP 다운로드 — 0.1.5](https://github.com/seominpapa/DotDock/releases/download/v0.1.5/DotDock-3D-Models-0.1.5.zip)를 이용하세요. [각 GLB와 검증용 매니페스트](https://github.com/seominpapa/DotDock/tree/v0.1.5/public/models)도 공개되어 있습니다. ZIP에는 `models/` 아래 12개 GLB, 사용 안내, 파일별 SHA-256 목록과 버전이 고정된 매니페스트가 들어 있습니다. 압축을 푼 GLB는 **GLB 가져오기**로 직접 선택할 수 있습니다.

3D를 선택한 경우에만 렌더러와 선택한 모델 하나를 불러옵니다. 회전·크기 변경 등 화면 변화가 있을 때만 다시 그리고, 숨김·최소화 시 렌더링을 멈추며 2D로 전환하면 GPU 자원을 해제합니다. 3D를 선택하면 추가 GPU 메모리를 사용하며 장비별 사용량은 다를 수 있습니다.

**GLB 가져오기**로 Tripo 등에서 내보낸 사용자 모델로 바꿀 수 있습니다. 텍스처가 내장된 비압축 GLB 2.0 정적 모델만 지원하며 파일 10MB, 삼각형 20,000개, 텍스처 가로·세로 2048px 이하로 제한합니다. 애니메이션·리깅·모프·여러 장면·외부 파일/URL을 참조하는 모델은 거부하고, 모델을 읽거나 표시하지 못하면 2D 캐릭터로 돌아갑니다. **기본 12지신 사용**을 누르면 기본 모델로 복원합니다.

기본 12종은 파스텔 토이 스타일을 바탕으로 Tripo P1에서 생성한 정적 모델이며, 닭은 흰색 피규어 형태입니다. SVG·도트와는 별도의 그림이며 표정·세부 형태가 다를 수 있습니다. 모델을 직접 불러오거나 표시하는 과정에서는 Tripo API를 호출하거나 크레딧을 사용하지 않습니다.

## 개발 및 검증

Node.js 22 이상을 권장합니다. 모델 검증·ZIP 패키징에는 Python 3가 필요하며 추가 Python 패키지는 사용하지 않습니다.

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

`test:electron`은 임시 사용자 프로필로 실제 Electron 앱을 실행합니다. 초기 설정, 생일·나이 계산, 12종 SVG·도트·3D 표시, 1.5배 확대, 3D 회전·유휴/숨김 렌더 중단·사용자 GLB·2D 복원, 다중 사용량 선택, 메모·위치·설정 복원, 시스템 정보 응답, 로컬 파일 연동을 검사합니다. GLB 선택 창에는 테스트 파일을 지정하며 실제 사용자 인증과 시작프로그램 설정은 건드리지 않습니다. GPU 수치는 조회 결과의 형식·범위를 검사하며 물리 장비별 정확도를 보장하지 않습니다.

```bash
npm run dist:mac
npm run dist:win
```

`.github/workflows/release.yml`은 macOS Apple Silicon·Intel과 Windows x64에서 소스 앱과 설치 파일에서 꺼내거나 설치한 앱을 실행 검증합니다. `v<package.json 버전>` 태그를 푸시하면 모든 작업이 성공한 뒤 설치 파일·SHA256SUMS를 GitHub Releases에 게시합니다. 실패 시 Actions의 검사 보고서와 스크린샷을 확인하세요. 실제 사용자 PC의 수동 설치·외부 계정 로그인·다양한 GPU 성능은 별도 검증이 필요합니다.

Apple Silicon 맥과 Windows CI에서는 12종 3D·회전·사용자 GLB 표시를 검사합니다. Intel 맥 CI는 WebGL을 제공하지 않아, 이를 먼저 확인하고 3D 선택·재시작 시 2D로 복원되는 동작을 검사합니다. 실제 Intel 맥의 3D 렌더링은 미검증입니다. WebGL을 지원하는 환경에서는 3D 검사를 생략하지 않으며 검사 보고서에 그래픽 지원 여부와 렌더러를 기록합니다.

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
