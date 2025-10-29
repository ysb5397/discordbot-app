const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// commands 폴더에서 명령어 파일들을 읽어옴
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    } else {
        console.log(`[경고] ${filePath} 명령어에 필요한 "data" 또는 "execute" 속성이 없습니다.`);
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

// Discord API에 명령어 등록
(async () => {
    try {
        console.log(`(/) ${commands.length}개의 슬래시 명령어 등록을 시작합니다.`);

        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        console.log(`(/) ${data.length}개의 슬래시 명령어를 성공적으로 등록했습니다.`);
    } catch (error) {
        console.error('(/) 슬래시 명령어 등록 중 오류 발생:', error);
        process.exit(1);
    }
})();