const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const dotenv = require('dotenv');
const { connectDB } = require('./utils/database');

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// --- 명령어 핸들러 로딩 ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[경고] ${filePath} 명령어에 필요한 "data" 또는 "execute" 속성이 없습니다.`);
    }
}

// --- 이벤트 핸들러 로딩 (재귀적) ---
const eventsPath = path.join(__dirname, 'events');

const loadEvents = (dir) => {
    const eventFiles = fs.readdirSync(dir).filter(file => file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = path.join(dir, file);
        const event = require(filePath);
        if (event.name) {
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
            console.log(`[이벤트 로드] ${file} 이벤트가 로드되었습니다.`);
        } else {
            console.log(`[경고] ${filePath} 이벤트에 필요한 "name" 속성이 없습니다.`);
        }
    }
};

// 최상위 events 폴더 로드
loadEvents(eventsPath);

// events 하위 폴더 로드
const eventFolders = fs.readdirSync(eventsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

for (const folder of eventFolders) {
    loadEvents(path.join(eventsPath, folder));
}


// 봇 로그인
client.login(process.env.DISCORD_BOT_TOKEN);

// Cloud Run의 헬스 체크(PORT=8080)를 통과하기 위한 더미 웹서버
const app = express();
// Cloud Run이 주는 PORT 환경 변수를 쓰거나, 없으면 8080을 씀
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
  // 봇이 살아있는지 확인용
  res.send('Discord bot is running!');
});

const startBot = async () => {
    try {
        // 1. DB 연결을 먼저 시도
        await connectDB();
        
        // 2. DB 연결에 성공해야만 봇 로그인을 시도
        console.log('DB 연결 성공. 봇 로그인을 시도합니다...');
        await client.login(process.env.DISCORD_BOT_TOKEN);

    } catch (error) {
        // 3. DB 연결이나 봇 로그인 실패 시
        console.error("!!! 봇 시작 중 치명적인 오류 발생 !!!", error);
        process.exit(1); // Cloud Run에 "시작 실패"를 알림
    }
};

// 봇 시작!
startBot();

app.listen(port, () => {
  console.log(`Dummy server listening on port ${port}`);
});
