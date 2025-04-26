// discord.js v14 이상 필요
// 필요한 모든 모듈을 한 번에 불러옵니다.
const {
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder,
    InteractionType, Events, ChannelType, GuildScheduledEventPrivacyLevel,
    GuildScheduledEventEntityType, PermissionsBitField // 권한 확인을 위해 추가
} = require('discord.js');
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config(); // .env 파일 로드

// v14 Intents 사용
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- 환경 변수 확인 및 로드 ---
const discordToken = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

// 필수 환경 변수 확인
if (!discordToken || !clientId || !guildId || !flowiseEndpoint) {
    console.error("필수 환경 변수(DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, FLOWISE_ENDPOINT) 중 하나 이상이 설정되지 않았습니다.");
    process.exit(1);
}
if (!flowiseApiKey) {
    console.warn("환경 변수 'FLOWISE_API_KEY'가 설정되지 않았습니다. API 키가 필요 없는 Flowise 설정인 경우 무시하세요.");
}

// --- 슬래시 명령어 정의 (모든 명령어 통합) ---
const commands = [
    // /chat 명령어
    new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화합니다.')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
    // /help 명령어
    new SlashCommandBuilder().setName('help').setDescription('봇 도움말을 표시합니다.'),
    // /avatar 명령어
    new SlashCommandBuilder().setName('avatar').setDescription('당신의 아바타 URL을 보여줍니다.'),
    // /server 명령어
    new SlashCommandBuilder().setName('server').setDescription('서버 정보를 보여줍니다.'),
    // /call 명령어
    new SlashCommandBuilder().setName('call').setDescription('콜백 메시지를 보냅니다.'),
    // /create_event 명령어
    new SlashCommandBuilder()
        .setName('create_event')
        .setDescription('서버 이벤트를 생성합니다.')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('이벤트의 이름을 입력하세요.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('이벤트 설명을 입력하세요.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('start_time')
                .setDescription("시작 시간 (예: '2025-05-10 20:00') - KST 기준")
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('이벤트가 열릴 음성 또는 스테이지 채널')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(true))

].map(command => command.toJSON());

// --- 명령어 등록 로직 ---
const rest = new REST({ version: '10' }).setToken(discordToken);

(async () => {
    try {
        console.log('(/) 슬래시 명령어 등록 시작...');
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands }, // 통합된 명령어 배열 사용
        );
        console.log('(/) 슬래시 명령어가 성공적으로 등록되었습니다.');
    } catch (error) {
        console.error('(/) 슬래시 명령어 등록 중 오류 발생:', error);
    }
})();


// --- 유틸리티 함수 ---
const sleep = (ms) => {
    return new Promise((r) => setTimeout(r, ms));
}

// --- Discord 봇 로그인 ---
const discordLogin = async () => {
    try {
        await client.login(discordToken);
    } catch (error) {
        console.error("Discord 로그인 실패:", error.message);
        if (error.code === 'TOKEN_INVALID') {
            console.error("-> 제공된 토큰이 유효하지 않습니다.");
        }
        await sleep(5000);
        process.exit(1);
    }
}

discordLogin();

// --- 이벤트 핸들러 ---
client.on(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}.`);
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

// --- 슬래시 명령어 처리 핸들러 (하나의 핸들러로 통합) ---
client.on(Events.InteractionCreate, async interaction => {
    console.log('Interaction received!');
    if (!interaction.isChatInputCommand()) {
        console.log('Interaction is not a chat input command.');
        return;
    }

    const { commandName } = interaction;
    console.log(`Processing interaction: /${commandName}`);

    // --- /chat 명령어 처리 ---
    if (commandName === 'chat') {
        if (interaction.deferred || interaction.replied) {
             console.log("Interaction already deferred or replied.");
             return;
        }
        try {
            await interaction.deferReply(); // 응답 지연
        } catch (deferError) {
            console.error("Failed to defer reply:", deferError);
            return;
        }

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const attachment = interaction.options.getAttachment('file');

        // Flowise API 요청 본문
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId
            }
        };
        if (attachment) {
            requestBody.uploads = [{
                type: 'url',
                name: attachment.name,
                mime: attachment.contentType || 'application/octet-stream',
                data: attachment.url
            }];
        }

        console.log(`[Session: ${sessionId}] Sending to Flowise:`, JSON.stringify(requestBody, null, 2));

        try {
            // Flowise API 호출
            const response = await fetch(flowiseEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {})
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                return;
            }

            const flowiseResponse = await response.json();
            console.log(`[Session: ${sessionId}] Received from Flowise:`, flowiseResponse);

            // Embed로 응답 보내기
            let replyEmbeds = [];
            const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);

            if (imageUrl) {
                const imageEmbed = new EmbedBuilder()
                    .setTitle('AI가 생성한 이미지')
                    .setImage(imageUrl)
                    .setColor(0x0099FF);
                replyEmbeds.push(imageEmbed);
            }

            const replyText = flowiseResponse.text;
            if (replyText && !imageUrl) {
                const textEmbed = new EmbedBuilder()
                    .setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText)
                    .setColor(0x00FA9A) // MediumSpringGreen
                    .setTimestamp()
                    .setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });
                replyEmbeds.push(textEmbed);
            } else if (!imageUrl && !replyText) {
                 const errorEmbed = new EmbedBuilder()
                    .setDescription('죄송합니다, AI로부터 답변을 받지 못했습니다.')
                    .setColor(0xFF0000);
                 replyEmbeds.push(errorEmbed);
            }

            // 사용자 멘션과 함께 Embed 전송
            const mentionString = `<@${interaction.user.id}>`;
            await interaction.editReply({ content: mentionString, embeds: replyEmbeds }); // Embed와 함께 멘션

        } catch (error) {
            console.error(`[Session: ${sessionId}] Error processing Flowise request for /chat:`, error);
            try {
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`);
            } catch (editError) {
                console.error("Failed to send error reply via editReply:", editError);
            }
        }
    }
    // --- /create_event 명령어 처리 ---
    else if (commandName === 'create_event') {
        // 권한 확인 (ManageEvents 권한 확인)
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
             return interaction.reply({ content: '이 명령어를 사용하려면 이벤트 관리 권한이 필요합니다.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true }); // 명령어 사용자에게만 진행 상황 표시

            // 옵션 값 가져오기
            const eventName = interaction.options.getString('name');
            const eventDescription = interaction.options.getString('description');
            const startTimeString = interaction.options.getString('start_time');
            const eventChannel = interaction.options.getChannel('channel');

            // 시작 시간 처리 (간단 예시 - 라이브러리 사용 권장)
            let scheduledStartTime;
            try {
                const dateParts = startTimeString.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})/);
                if (!dateParts) throw new Error('Invalid date format');
                // 주의: 서버 시간대 영향 받을 수 있음
                scheduledStartTime = new Date(parseInt(dateParts[1]), parseInt(dateParts[2]) - 1, parseInt(dateParts[3]), parseInt(dateParts[4]), parseInt(dateParts[5]));
                if (isNaN(scheduledStartTime.getTime())) throw new Error('Invalid date');
                if (scheduledStartTime < new Date()) {
                    return interaction.editReply('오류: 이벤트 시작 시간은 현재 시간 이후여야 합니다.');
                }
            } catch (e) {
                console.error("Date parsing error:", e);
                return interaction.editReply(`오류: 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요. (예: '2025-05-10 20:00')`);
            }

            // 이벤트 생성 옵션
            const eventOptions = {
                name: eventName,
                description: eventDescription,
                scheduledStartTime: scheduledStartTime,
                privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                entityType: eventChannel.type === ChannelType.GuildStageVoice ? GuildScheduledEventEntityType.StageInstance : GuildScheduledEventEntityType.Voice,
                channel: eventChannel.id
            };

            // 이벤트 생성
            const createdEvent = await interaction.guild.scheduledEvents.create(eventOptions);

            console.log(`Event created: ${createdEvent.name} (ID: ${createdEvent.id})`);
            await interaction.editReply(`✅ 이벤트 "${createdEvent.name}"이(가) 성공적으로 생성되었습니다!`);

        } catch (error) {
            console.error('Error creating scheduled event:', error);
            // 오류 메시지에 권한 문제 가능성 언급 추가
            await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 입력값, 봇의 "이벤트 관리" 권한, 또는 채널 설정을 확인해주세요.');
        }
    }
    // --- 다른 슬래시 명령어 처리 ---
    else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("도움말")
            .setColor(0xFFD700) // 금색으로 변경
            .setDescription('명령어: /chat [질문] [file:첨부파일], /help, /avatar, /server, /call, /create_event [옵션들]'); // /create_event 추가
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    else if (commandName === 'avatar') {
        await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true });
    }
    else if (commandName === 'server') {
        await interaction.reply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`);
    }
     else if (commandName === 'call') {
        await interaction.reply(`<@${interaction.user.id}> !callback`);
    }
});

// --- 기존 메시지 기반 명령어 처리 (주석 처리 또는 제거) ---
/*
client.on('messageCreate', async msg => {
    // ...
});
*/
// ```

// **주요 수정 사항:**

// 1.  **`require` 정리:** 필요한 모든 `discord.js` 모듈을 파일 상단에서 한 번만 불러옵니다. (`PermissionsBitField` 추가)
// 2.  **`commands` 배열 통합:** `/chat`과 `/create_event`를 포함한 모든 명령어 정의를 하나의 `commands` 배열로 합쳤습니다.
// 3.  **`InteractionCreate` 핸들러 통합:** `client.on(Events.InteractionCreate, ...)` 핸들러를 하나만 사용하고, 내부에서 `if/else if`를 사용하여 `commandName`에 따라 각 명령어 로직을 분기합니다.
// 4.  **권한 확인 수정:** `/create_event`에서 권한 확인 시 `interaction.member.permissions` 대신 `interaction.memberPermissions`를 사용하고, 문자열 대신 `PermissionsBitField.Flags.ManageEvents`를 사용하도록 수정했습니다 (v14 방식).
// 5.  **다른 명령어 처리:** 다른 명령어(`/help`, `/avatar` 등) 처리 로직도 `else if` 블록 안에 포함시켰습니다. `/help` 설명에 `/create_event`를 추가했습니다.

// 이제 이 통합된 코드를 사용하시면 `/chat`과 `/create_event` 명령어를 모두 처리할 수 있습
