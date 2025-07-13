// deploy-commands.js

const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
}

// Construct and prepare an instance of the REST module
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

// and deploy your commands!
(async () => {
    try {
        console.log(`(/) ${commands.length}개의 슬래시 명령어 등록을 시작합니다.`);

        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: commands },
        );

        console.log(`(/) ${data.length}개의 슬래시 명령어를 성공적으로 등록했습니다.`);
    } catch (error) {
        console.error(error);
    }
})();