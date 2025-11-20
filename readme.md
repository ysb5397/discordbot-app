# 🤖 Discord Bot With AI (Gemini & Flowise)
**Google Gemini 2.5**와 **Flowise**를 기반으로 한 초지능형 디스코드 봇입니다.
단순한 텍스트 대화를 넘어, **실시간 음성 대화(Gemini Live)**, **멀티미디어 생성(이미지/비디오)**, **심층 리서치**, **음악 재생**, 그리고 **서버 관리**까지 수행하는 AI 에이전트입니다.

또한, 외부 애플리케이션(예: Flutter App)과의 연동을 위한 **REST API 서버**도 내장되어 있습니다.

## ✨ 주요 기능 (Key Features)
### 1. 🧠 AI 채팅 (/chat)
- 멀티 모델 지원: Gemini 2.5 Flash (빠른 응답) 및 Gemini 2.5 Pro (고성능) 모델을 선택하여 대화할 수 있습니다.
- 스트리밍 응답: AI의 답변을 기다리지 않고 거의 실시간으로 타자 치듯 볼 수 있습니다.(디스코드 정책상 딜레이가 있음)
- 장기 기억 (Memory): MongoDB에 저장된 과거 대화 내역을 문맥으로 활용하여 개인화된 답변을 제공합니다.
- 멀티모달 (첨부파일): 이미지나 텍스트 파일을 첨부하면 AI가 내용을 분석하고 질문에 답합니다.
- 안정성 확보: Gemini 호출 실패 시 Flowise로 자동 폴백(Fallback)되어 끊김 없는 대화를 보장합니다.

### 2. 🎙️ 실시간 음성 대화 & 음악 (Voice System)
* 봇은 음성 채널의 상황에 따라 두 가지 모드로 작동합니다.
  - 🤖 Gemini Live 모드 (기본):
  - GeminiVoiceManager가 작동하여 사용자의 음성을 실시간으로 인식합니다.
  - STT & TTS: 사용자의 말을 텍스트로 변환하고, AI의 응답을 자연스러운 음성으로 출력합니다.
  - 인터럽트 지원: 사용자가 말하면 듣기 모드로 자동 전환됩니다.

* 🎵 유튜브 뮤직 모드 (/youtube):
  - YoutubeManager를 통해 유튜브 음원을 고음질로 재생합니다.
  - /youtube play, /youtube skip, /youtube stop 명령어로 큐(Queue)를 관리합니다.

### 3. 🎨 크리에이티브 스튜디오
- 이미지 생성 (/imagen): Google Imagen 4 모델을 사용하여 고품질 이미지를 생성합니다. (최대 4장)
- 비디오 생성 (/video): Google Veo 3 모델을 사용하여 텍스트 프롬프트 기반의 짧은 영상을 제작합니다.

### 4. 🔬 지식 탐색 & 유틸리티
- 서치 (/search normal, /search detailed): Python 백엔드 에이전트와 연동하여 웹을 탐색하고, 보고서(.md 파일)를 작성해줍니다.
- URL 보안 검사: 채팅에 올라오는 링크를 urlscan.io를 통해 실시간으로 스캔하고, 악성 링크일 경우 자동으로 삭제 및 경고합니다.
- 실시간 지진 알림: 기상청 API를 30초(설정 가능)마다 확인하여 규모 2.0 이상의 지진 발생 시 즉시 알림을 전송합니다.
- 일일 브리핑: 매일 설정된 시간에 주요 뉴스나 트렌드를 요약하여 브리핑해줍니다. (/scheduler)

### 5. 🛡️ 관리 및 유지보수
- 에러 자동 진단 (/maintain): 시스템 에러 발생 시, AI가 로그와 코드를 분석하여 원인과 해결책이 담긴 보고서를 관리자에게 제공합니다.
- 화이트리스트 시스템: 승인된 사용자만 봇을 사용하거나 특정 역할을 부여받을 수 있습니다. (/white_list)
- 기억 관리 (/memory): 저장된 대화 내용을 검색, 수정, 삭제할 수 있습니다.

### 6. 📱 외부 앱 연동 API (Express Server)
- 봇은 5500 포트(기본값)에서 REST API 서버를 실행하여 외부 앱(Flutter 등)과 통신합니다.
- POST /api/login: 비밀번호 인증 및 JWT 토큰 발급.
- GET /api/config: 현재 활성화된 AI API 키 조회.
- POST /api/chat: 외부 앱에서의 채팅 요청을 Flowise 등으로 중계.

## 🏗️ 시스템 아키텍처
- 이 프로젝트는 Node.js 봇과 무거운 AI 작업을 처리하는 Python AI Service로 구성된 마이크로서비스 구조를 권장합니다.

```
graph TD
    User[Discord User] -->|Interaction| DiscordGateway
    DiscordGateway -->|Events| NodeBot[🤖 Node.js Discord Bot]
    
    subgraph "Core Services"
        NodeBot -->|Read/Write| MongoDB[(MongoDB Atlas)]
        NodeBot -->|API Call| GoogleGemini[Google Gemini API]
        NodeBot -->|Fallback| Flowise[Flowise AI]
        NodeBot -->|Voice/Music| FFmpeg[FFmpeg & Opus]
    end
    
    subgraph "External Tools"
        NodeBot -->|Heavy Task| PythonService[🐍 Python AI Service]
        PythonService -->|Deep Research| WebSearch
        PythonService -->|Gen Media| Imagen/Veo
        NodeBot -->|Security| UrlScan[urlscan.io]
        NodeBot -->|Info| KMA[기상청 API]
    end
    
    ExtApp[Mobile App] -->|HTTP/JWT| NodeBot
```

### 🛠️ 기술 스택
- Runtime: Node.js v22+ (Dockerized)
- Framework: Discord.js v14, Express.js
- Database: MongoDB (Mongoose)
- AI Engine:
  - Google Gemini 2.5 (Flash/Pro/Live)
  - Flowise
  - Google Imagen & Veo
  - Media Processing: @discordjs/voice, fluent-ffmpeg, prism-media, ytdl-core
- Infrastructure: Koyeb, Docker, GitHub Actions

### 🚀 설치 및 실행 가이드
1. 환경 변수 설정 (.env)
프로젝트 루트에 .env 파일을 생성하고 다음 변수들을 설정하세요. (config/manage_environments.js 참조)

```
# --- Discord 설정 ---
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_GUILD_ID=your_test_guild_id
MY_DISCORD_USER_ID=owner_id_for_admin_commands
DISCORD_LOG_CHANNEL_ID=channel_id_for_logging
BASE_MEMBER_ROLE_ID=role_id_to_auto_assign_new_members
IS_DEV_BOT=false # 개발용 봇 여부 (true/false)

# --- Channel IDs (자동 입장 및 알림용) ---
AUTO_JOIN_CHANNEL_ID=voice_channel_id
GEMINI_VOICE_CHANNEL_ID=voice_channel_id_for_ai
YOUTUBE_VOICE_CHANNEL_ID=voice_channel_id_for_music
EARTHQUAKE_NOTICE_CHANNEL_ID=text_channel_id
IGNORE_AI_CHAT_CHANNEL_ID=text_channel_id_to_ignore

# --- Database ---
MONGODB_URI=mongodb+srv://...

# --- AI & External APIs ---
GEMINI_API_KEY=your_google_ai_studio_key
PYTHON_AI_SERVICE_URL=http://your-python-backend-url # 이미지/비디오/리서치용
FLOWISE_ENDPOINT=http://your-flowise-url/api/v1/prediction/...
FLOWISE_API_KEY=your_flowise_key

# --- Google Search (for simple search) ---
GOOGLE_SEARCH_API=your_google_cloud_api_key
GOOGLE_SEARCH_ENGINE_ID=your_cse_id

# --- Security & ETC ---
URL_CHECK_API_KEY=your_urlscan_io_key
EQK_AUTH_KEY=your_kma_api_key
JWT_SECRET=secret_key_for_api_server
```

2. 로컬 실행
필수 요구 사항: Node.js 22 이상, Python 3, FFmpeg가 설치되어 있어야 합니다.

```
# 의존성 설치
yarn install

# 명령어 등록 (최초 1회 혹은 명령어 변경 시)
node deploy-commands.js

# 개발 모드 실행 (nodemon)
yarn dev

# 프로덕션 모드 실행
yarn start
```

3. Docker 실행
```
# 이미지 빌드
docker build -t discord-bot .

# 컨테이너 실행
docker run --env-file .env -p 5500:5500 discord-bot
```

### 📚 명령어 목록


| 명령어 | 설명 | 권한 |
|-----|-----|-----|
| /chat | AI와 대화하거나 파일을 분석합니다. (모델 선택 가능) | 전체 |
| /imagen | 텍스트 프롬프트로 이미지를 생성합니다. | 전체 |
| /video | 텍스트 프롬프트로 영상을 생성합니다. | 전체 |
| /search | 구글 검색(normal) 또는 심층 리서치(detailed)를 수행합니다. | 전체 |
| /youtube | 음악을 재생(play), 건너뛰기(skip), 정지(stop)합니다. | 전체 |
| /memory | 저장된 AI와의 기억을 검색, 수정, 삭제합니다. | 전체 |
| /event | 서버 일정을 생성하고 관리합니다. | 매니저 |
| /scheduler | 지진 감지 주기나 일일 브리핑 일정을 설정합니다. | 관리자 |
| /maintain | AI를 사용하여 발생한 에러 로그를 분석하고 리포트를 받습니다. | 관리자 |
| /reset_key | 외부 앱 연동용 API 키를 재발급합니다. | 관리자 |
| /reload_db | 데이터베이스 연결을 재시도 합니다. | 관리자 |
| /white_list | 특정 유저의 화이트리스트 여부를 설정합니다. | 관리자 |

### 📂 폴더 구조
```
.
├── commands/             # 슬래시 명령어 핸들러 (chat, youtube, imagen 등)
├── config/               # 환경변수 및 API 서버 설정
│   ├── api/              # Express 서버 로직
│   └── manage_environments.js
├── events/               # 디스코드 이벤트 리스너
│   ├── chat/             # 메시지 감지 (URL 스캔, 자동 응답)
│   ├── voice/            # 음성 채널 상태 감지
│   └── ...
├── utils/                # 핵심 유틸리티
│   ├── ai_helper.js      # AI 모델(Gemini, Flowise) 호출 래퍼
│   ├── voice_helper.js   # Gemini Live 음성 처리 로직
│   ├── youtube_helper.js # 유튜브 재생 로직
│   ├── database.js       # MongoDB 스키마 및 연결
│   ├── earthquake.js     # 지진 정보 파싱 및 알림
│   └── ...
├── index.js              # 봇 엔트리 포인트
├── deploy-commands.js    # 명령어 등록 스크립트
└── Dockerfile            # 배포용 Docker 설정
```

### ⚠️ 주의사항
- Python AI Service: /imagen, /video, /search 기능은 별도의 Python 백엔드 서버(PYTHON_AI_SERVICE_URL)가 필요합니다. 이 봇 단독으로는 해당 기능들이 작동하지 않을 수 있습니다.
- FFmpeg: 음성 기능을 사용하기 위해 시스템에 FFmpeg가 설치되어 있거나 ffmpeg-static 패키지가 올바르게 작동해야 합니다.
- Database: MongoDB 연결 없이는 봇이 시작되지 않습니다.

Developed With [Gemini]
