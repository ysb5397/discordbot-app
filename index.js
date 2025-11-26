// index.js
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const config = require('./config/manage_environments.js');
const { connectDB } = require('./utils/system/database');
const { logToDiscord } = require('./utils/system/catch_log');
const { registerGlobalCommands } = require('./deploy-commands.js');
const { startApiServer } = require('./config/api/server');
const { reloadBriefingSchedule } = require('./utils/scheduler/briefing_scheduler.js');
const { startCodeReviewSchedule } = require('./utils/scheduler/code_review_scheduler.js');
const { startMemoryConsolidationSchedule } = require('./utils/scheduler/memory_scheduler.js');
const { startStockAnalysisSchedule } = require('./utils/scheduler/stock_scheduler.js');

// --- 1. 클라이언트 초기화 ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

client.amIActive = true;

process.on('uncaughtException', async (error, origin) => {
    console.error('!!! 치명적인 예외 발생 (Uncaught Exception) !!!', error);
    try {
        if (client.isReady()) {
            await logToDiscord(client, 'ERROR', '처리되지 않은 치명적인 예외가 발생했습니다!', null, error, origin);
        }
    } catch (loggingError) {
        console.error('에러 로깅 중 추가 오류 발생:', loggingError);
    } finally {
        console.log('프로세스를 종료합니다.');
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('!!! 처리되지 않은 Promise 거부 (Unhandled Rejection) !!!', reason);
    const error = (reason instanceof Error) ? reason : new Error(String(reason));
    if (client.isReady()) {
        logToDiscord(client, 'ERROR', '처리되지 않은 Promise 거부가 발생했습니다!', null, error, 'unhandledRejection');
    }
});

// --- 3. 명령어 및 이벤트 로더 ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[경고] ${filePath} 명령어에 "data" 또는 "execute"가 없습니다.`);
    }
}

const eventsPath = path.join(__dirname, 'events');
const loadEvents = (dir) => {
    const eventFiles = fs.readdirSync(dir).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const filePath = path.join(dir, file);
        const event = require(filePath);
        if (event.name) {
            if (event.once) client.once(event.name, (...args) => event.execute(...args, client));
            else client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
};

// 이벤트 폴더 재귀 로드 (단순화)
loadEvents(eventsPath);
fs.readdirSync(eventsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .forEach(dirent => loadEvents(path.join(eventsPath, dirent.name)));


// --- 4. 메인 실행 함수 ---
const startBot = async () => {
    try {
        await connectDB();

        await client.login(config.discord.token);
        console.log(`✅ ${client.user.tag} 로그인 완료!`);

        reloadBriefingSchedule(client);
        startCodeReviewSchedule(client);
        startMemoryConsolidationSchedule(client);
        startStockAnalysisSchedule(client);

        await registerGlobalCommands(config.server.commitSha);

        startApiServer(client);

    } catch (error) {
        console.error("!!! 봇 시작 중 치명적인 오류 발생 !!!", error);
        process.exit(1);
    }
};

startBot();
