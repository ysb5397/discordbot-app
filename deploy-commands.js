const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const { DeploymentStatus } = require('./utils/database');
const config = require('./config/manage_environments');

const DISCORD_BOT_TOKEN = config.discord.token;
const DISCORD_CLIENT_ID = config.discord.clientId;
const DISCORD_GUILD_ID = config.discord.guildId;

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

/**
 * (index.js가 호출할 함수)
 * DB 플래그를 확인하여 글로벌 명령어만을 갱신하는 함수
 * @param {string} commitSha - 현재 배포의 커밋 해시
 */
async function registerGlobalCommands(commitSha) {
    if (!commitSha) {
        console.warn('(/) COMMIT_SHA 환경 변수가 없어 명령어 등록 상태 확인을 건너뜁니다. 로컬 개발 환경일 수 있습니다.');
        return;
    }
    if (!DISCORD_CLIENT_ID) {
        throw new Error('CLIENT_ID가 설정되지 않았습니다.');
    }

    try {
        // 1. 현재 커밋에 대해 명령어가 이미 등록되었는지 DB 확인
        const status = await DeploymentStatus.findOne({ commitSha: commitSha });

        if (status && status.commandsRegistered) {
            console.log(`(/) 현재 커밋(${commitSha.substring(0, 7)})에 대한 [글로벌] 명령어는 이미 등록되었습니다. 건너뜁니다.`);
            return;
        }

        // 2. 등록되지 않았다면 명령어 로드 및 등록 시도
        console.log(`(/) 현재 커밋(${commitSha.substring(0, 7)})에 대한 [글로벌] 명령어 등록을 시작합니다...`);

        await addAllCommands(commands, commandFiles);

        // 3. 성공 시 DB에 상태 업데이트 (upsert 사용)
        await DeploymentStatus.findOneAndUpdate(
            { commitSha: commitSha },
            { $set: { commandsRegistered: true, timestamp: new Date() } },
            { upsert: true, new: true }
        );
        console.log(`(/) DB에 명령어 등록 완료 상태를 기록했습니다 (Commit: ${commitSha.substring(0, 7)}).`);

    } catch (error) {
        console.error('(/) [글로벌] 명령어 등록 실패:', error);
        throw error; // 봇 시작을 중단시키기 위해 에러를 다시 던짐
    }
}

/**
 * (수동 청소용 함수)
 * 글로벌과 길드 명령어를 모두 청소합니다.
 */
async function cleanAllCommands() {
    if (!DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
        console.error('오류: .env 파일에 DISCORD_CLIENT_ID와 DISCORD_GUILD_ID가 모두 필요합니다.');
        process.exit(1);
    }
    try {
        console.log('(/) 모든 [글로벌] 명령어 청소를 시작합니다...');
        await rest.put(
            Routes.applicationCommands(DISCORD_CLIENT_ID),
            { body: [] }, // 글로벌 명령어 비우기
        );
        console.log('(/) [글로벌] 명령어 청소 완료.');

        console.log(`(/) '${DISCORD_GUILD_ID}' 서버의 [길드] 명령어 청소를 시작합니다...`);
        await rest.put(
            Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
            { body: [] }, // 길드 명령어 비우기
        );
        console.log('(/) [길드] 명령어 청소 완료.');

        console.log('\n✅ 모든 명령어 청소가 완료되었습니다.');

    } catch (error) {
        console.error('(/) 명령어 청소 중 오류 발생:', error);
        process.exit(1);
    }
}

async function addAllCommands(commands, commandFiles) {
for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        } else {
            console.log(`[경고] ${filePath} 명령어에 필요한 "data" 또는 "execute" 속성이 없습니다.`);
        }
    }

    console.log(`(/) ${commands.length}개의 명령어를 [글로벌]로 등록 시도 중...`);
    
    await rest.put(
        Routes.applicationCommands(DISCORD_CLIENT_ID), // 글로벌로 등록
        { body: commands },
    );
    
    console.log(`(/) ${commands.length}개의 [글로벌] 명령어 등록 성공.`);
}

// --- 이 파일을 `require`할 땐 이 함수만 내보냄 ---
module.exports = {
    registerGlobalCommands
};

// --- 이 파일을 `node deploy-commands.js`로 직접 실행할 때만 아래 코드가 작동함 ---
if (require.main === module) {
    console.log('[수동 스크립트 실행 모드]');
    console.log('현재 꼬여있는 [글로벌] 및 [길드] 명령어를 모두 청소합니다...');
    
    // DB 연결이 필요할 수 있으므로, connectDB를 임포트해서 실행
    const { connectDB } = require('./utils/database');
    (async () => {
        await cleanAllCommands();
        await addAllCommands(commands, commandFiles);
        await connectDB();
        console.log('DB 연결 완료. 모든 명령어 청소 및 재등록이 완료되었습니다.');
    })();
}