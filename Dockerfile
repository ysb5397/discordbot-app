FROM node:22.12-slim

WORKDIR /usr/src/app

COPY package.json yarn.lock* ./

RUN apt-get update && apt-get install -y python3 build-essential git

RUN yarn install --frozen-lockfile

COPY . .

RUN git config --global --add safe.directory /usr/src/app

CMD [ "yarn", "start" ]
