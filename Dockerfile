# 1. Cloudtype.yml에서 Node.js 20 환경을 가져옵니다.
FROM node:22.12-slim

# 2. 작업 폴더를 만듭니다.
WORKDIR /usr/src/app

# 3. 필요한 라이브러리 목록 파일을 먼저 복사합니다.
COPY package.json yarn.lock* ./

# 4. Cloudtype.yml의 'install: yarn install' 명령어를 실행합니다.
RUN yarn install --frozen-lockfile

# 5. 나머지 모든 소스 코드를 복사합니다.
COPY . .

# 6. Cloudtype.yml의 'start: yarn start' 명령어로 봇을 실행합니다.
CMD [ "yarn", "start" ]
