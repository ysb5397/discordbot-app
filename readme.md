# 🤖 나만의 AI 비서 디스코드 봇

**모든 대화와 이미지를 기억하고, 음성으로 소통하며, 실시간 정보까지 알려주는 나만의 똑똑한 AI 비서 봇입니다.**

이 봇은 사용자의 모든 활동을 MongoDB 데이터베이스에 기록하여 개인화된 기억을 형성합니다. Google Gemini와 Flowise AI를 통해 이 기억을 바탕으로 자연스러운 대화를 나누거나, 이미지를 분석하고 생성하며, 음성으로 실시간 소통하는 것을 목표로 합니다.

---

## ✨ 주요 기능

* **🧠 자동 기억 저장**: 서버 내의 모든 메시지와 이미지를 자동으로 데이터베이스에 저장하여 '기억'으로 활용합니다.
    * **이미지 분석**: 사용자가 올린 이미지를 AI가 분석하여, 이미지에 대한 설명을 텍스트로 함께 저장합니다.
* **💬 AI 채팅 및 기억 검색**: `/chat` 명령어로 AI와 대화할 수 있습니다. AI는 대화 내용과 관련된 과거의 '기억'을 스스로 찾아 대화에 활용합니다.
* **🎙️ 실시간 음성 대화**: 특정 음성 채널에 사용자가 입장하면 봇이 자동으로 따라 들어와 대화를 나눕니다.
    * 사용자의 음성을 텍스트로 변환(STT)하고, 기억을 검색한 뒤, AI가 생성한 답변을 다시 음성(TTS)으로 출력합니다.
* **🎨 이미지 생성**: `/imagen` 명령어로 Gemini AI를 통해 고품질 이미지를 생성할 수 있습니다.
* **地震(지진) 실시간 알림**: 기상청 API를 주기적으로 확인하여, 국내에 새로운 지진 정보가 발표되면 지정된 채널로 즉시 알림을 보냅니다.
* **기억 관리**: `/memory` 명령어를 통해 저장된 기억을 수정하거나 삭제할 수 있습니다.

---

## 🛠️ 기술 스택

* **코어**: Node.js, Discord.js v14
* **데이터베이스**: MongoDB, Mongoose
* **AI**: Google Gemini, Flowise
* **음성 처리**: `@discordjs/voice`, `fluent-ffmpeg`, `prism-media`
* **배포**: Cloudtype, GitHub Actions

---

## 🚀 시작하기

### 1. 사전 준비

* Node.js (v20 이상 권장)
* Yarn
* MongoDB 데이터베이스

### 2. 프로젝트 클론 및 설정

```bash
# 1. 프로젝트를 컴퓨터로 복제합니다.
git clone [https://github.com/너의-깃허브-ID/너의-저장소-이름.git](https://github.com/너의-깃허브-ID/너의-저장소-이름.git)
cd 너의-저장소-이름

# 2. 필요한 패키지를 설치합니다.
yarn install

# 3. .env 파일을 생성하고 아래 내용을 채워넣습니다.
cp .env.example .env
```

### 3. 환경 변수 설정 (`.env`)

프로젝트 루트 경로에 `.env` 파일을 만들고 아래의 키 값들을 채워주세요.

```env
# Discord Bot
DISCORD_BOT_TOKEN=여기에_봇_토큰을_입력하세요
DISCORD_CLIENT_ID=여기에_봇_클라이언트_ID를_입력하세요
DISCORD_GUILD_ID=봇을_테스트할_서버_ID를_입력하세요

# Database
MONGODB_URI=여기에_MongoDB_연결_URI를_입력하세요

# AI APIs
GEMINI_API_KEY=여기에_Google_Gemini_API_키를_입력하세요
FLOWISE_ENDPOINT=여기에_Flowise_API_엔드포인트를_입력하세요
FLOWISE_API_KEY=여기에_Flowise_API_키를_입력하세요 (선택 사항)

# ETC APIs
EQK_API_KEY=여기에_기상청_API_키를_입력하세요
```

### 4. 명령어 등록 및 봇 실행

```bash
# 1. 디스코드 서버에 슬래시(/) 명령어를 등록합니다.
node deploy-commands.js

# 2. 개발 모드로 봇을 실행합니다 (코드 변경 시 자동 재시작).
yarn dev

# 3. 실제 운영 환경처럼 봇을 실행합니다.
yarn start
```

---

## ⚙️ 배포

이 프로젝트는 `main` 브랜치에 코드가 푸시(Push)되면, GitHub Actions가 자동으로 Cloudtype으로 배포하도록 설정되어 있습니다.
