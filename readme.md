# 🤖 AI 비서 디스코드 봇(AI 제작)

**모든 대화와 이미지를 기억하고, 음성으로 소통하며, 실시간 정보까지 알려주는 나만의 똑똑한 AI 비서 봇입니다.**

이 봇은 사용자의 모든 활동을 MongoDB 데이터베이스에 기록하여 개인화된 기억을 형성합니다. Google Gemini와 Flowise AI를 통해 이 기억을 바탕으로 자연스러운 대화를 나누거나, 이미지를 분석하고 생성하며, 음성으로 실시간 소통하는 것을 목표로 합니다.

---

## ✨ 주요 기능

* **🧠 자동 기억 및 학습**: 서버 내의 모든 메시지, 첨부 파일, 음성 대화를 자동으로 데이터베이스에 저장하여 '기억'으로 활용합니다.
    * **첨부 파일 분석**: 사용자가 올린 이미지나 텍스트 파일을 AI가 분석하여, 내용에 대한 설명을 텍스트로 함께 저장합니다.
* **💬 AI 채팅 및 기억 기반 대화**: `/chat` 명령어로 AI와 대화할 수 있습니다. AI는 대화 내용과 관련된 과거의 '기억'을 스스로 찾아 대화에 활용하여 맥락을 이해합니다.
* **🎙️ 실시간 음성 대화**: 특정 음성 채널에 사용자가 입장하면 봇이 자동으로 따라 들어와 대화를 나눕니다.
    * 사용자의 음성을 텍스트로 변환(STT)하고, 기억을 검색한 뒤, AI가 생성한 답변을 다시 음성(TTS)으로 실시간 출력합니다.
* **🎨 AI 이미지 생성**: `/imagen` 명령어로 Gemini AI를 통해 프롬프트 기반의 고품질 이미지를 생성할 수 있습니다.
* **🔬 심층 리서치**: `/deep_research` 명령어로 질문을 입력하면, AI가 최적의 검색어를 생성해 웹 검색을 수행하고, 그 결과를 종합하여 깊이 있는 답변을 제공합니다.
* **📢 실시간 지진 정보 알림**: 기상청 API를 주기적으로 확인하여, 국내에 새로운 지진 정보가 발표되면 지정된 채널로 즉시 알림을 보냅니다.
* **📅 이벤트 관리**: `/event` 명령어를 통해 서버 이벤트를 손쉽게 생성, 수정, 삭제할 수 있습니다.
* **💾 기억 관리**: `/memory` 명령어를 통해 저장된 기억을 자연어 기반으로 검색하여 수정하거나 삭제할 수 있습니다.

---

## 🏗️ 아키텍처

이 봇은 역할과 책임에 따라 명확하게 분리된 모듈식 구조를 가지고 있습니다.

* **`index.js`**: 봇의 시작점으로, 명령어와 이벤트를 로드하고 클라이언트를 실행합니다.
* **`commands/`**: 사용자가 직접 실행하는 모든 슬래시 명령어가 들어있습니다.
* **`events/`**: `MessageCreate`, `VoiceStateUpdate` 등 Discord Gateway 이벤트를 처리하는 핸들러가 들어있습니다.
* **`utils/`**: AI 호출(`ai_helper.js`), 데이터베이스 관리(`database.js`), 음성 처리(`VoiceManager.js`) 등 재사용 가능한 핵심 로직들이 모여있습니다.
* **배포**: `main` 브랜치에 코드가 푸시되면, GitHub Actions가 자동으로 Cloudtype에 배포합니다.

---

## 🛠️ 기술 스택

* **코어**: Node.js, Discord.js v14
* **데이터베이스**: MongoDB, Mongoose
* **AI**: Google Gemini (Text, Vision, Imagen), Flowise
* **음성 처리**: `@discordjs/voice`, `fluent-ffmpeg`, `prism-media`
* **배포**: Cloudtype, GitHub Actions

---

## 🚀 시작하기

### 1. 사전 준비

* Node.js (v20 이상 권장)
* Yarn
* MongoDB Atlas 계정
* 각종 API 키 (아래 `.env` 설정 참고)

### 2. 프로젝트 클론 및 설정

```bash
# 1. 프로젝트를 컴퓨터로 복제합니다.
git clone [https://github.com/ysb5397/discordbot-app.git](https://github.com/ysb5397/discordbot-app.git)
cd discordbot-app

# 2. 필요한 패키지를 설치합니다.
yarn install

# 3. .env 파일을 생성합니다.
3. 환경 변수 설정 (.env)
프로젝트 루트 경로에 있는 .env 파일을 열고 아래의 키 값들을 모두 채워주세요.

코드 스니펫

# Discord Bot
DISCORD_BOT_TOKEN= # Discord 개발자 포털에서 발급받은 봇 토큰
DISCORD_CLIENT_ID= # 봇의 클라이언트 ID
DISCORD_GUILD_ID= # 봇을 테스트할 서버(길드) ID

# Database
MONGODB_URI= # MongoDB Atlas 연결 URI

# AI APIs
GEMINI_API_KEY= # Google AI Studio에서 발급받은 Gemini API 키
FLOWISE_ENDPOINT= # 직접 구축한 Flowise의 API 엔드포인트
FLOWISE_API_KEY= # (선택) Flowise에 설정한 API 키

# Google Search API (for /deep_research)
GOOGLE_SEARCH_API= # Google Cloud Console에서 발급받은 Custom Search API 키
GOOGLE_SEARCH_ENGINE_ID= # 프로그래밍 가능 검색 엔진 ID

# ETC APIs
EQK_API_KEY= # 공공데이터포털에서 발급받은 기상청 지진통보 API 키
4. 명령어 등록 및 봇 실행
Bash

# 1. 디스코드 서버에 슬래시(/) 명령어를 등록합니다.
node deploy-commands.js

# 2. 개발 모드로 봇을 실행합니다 (코드 변경 시 자동 재시작).
yarn dev

# 3. 실제 운영 환경처럼 봇을 실행합니다.
yarn start