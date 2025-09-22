// index.js

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

// 봇 클라이언트 생성
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildVoiceStates // 음성 상태 감지를 위한 Intent 추가
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
        if (event.name) { // 이벤트 이름이 있는지 확인
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
