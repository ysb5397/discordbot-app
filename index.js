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
        GatewayIntentBits.GuildMessages, // 메시지 기반 명령어 처리가 없다면 제거 가능
        GatewayIntentBits.MessageContent // 메시지 기반 명령어 처리가 없다면 제거 가능
    ]
});

// --- 환경 변수 확인 및 로드 ---
const discordToken = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID; // 슬래시 명령어 등록에 필수
const guildId = process.env.DISCORD_GUILD_ID;   // 슬래시 명령어 등록에 필수 (특정 서버 전용)
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT; // Flowise 엔드포인트
const flowiseApiKey = process.env.FLOWISE_API_KEY;   // Flowise API 키 (선택 사항)

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
                .setDescription("시작 시간 (예: '2025-05-10 20:00') - 한국 시간(KST) 기준") // 설명에 KST 명시
                .setRequired(true))
        .addChannelOption(option => // 채널 옵션 (텍스트 채널 포함)
            option.setName('channel')
                .setDescription('이벤트가 열릴 음성, 스테이지 또는 텍스트 채널')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText)
                .setRequired(true))

].map(command => command.toJSON());

// --- 명령어 등록 로직 ---
const rest = new REST({ version: '10' }).setToken(discordToken);

(async () => {
    try {
        console.log('(/) 슬래시 명령어 등록 시작...');
        // 특정 서버(Guild)에 명령어 등록
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
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
    // 상호작용이 슬래시 명령어가 아니면 무시
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    console.log(`Processing interaction: /${commandName} by ${interaction.user.tag}`);

    // --- /chat 명령어 처리 ---
    if (commandName === 'chat') {
        // 이미 응답했거나 지연된 경우 무시
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
        const sessionId = interaction.user.id; // 사용자 ID를 세션 ID로 사용
        const attachment = interaction.options.getAttachment('file');

        // Flowise API 요청 본문 구성
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId
            }
        };
        // 파일 첨부 시 uploads 필드 추가
        if (attachment) {
            requestBody.uploads = [{
                type: 'url', // URL 방식으로 전달 (Flowise에서 처리 필요)
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

            // API 응답 오류 처리
            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                return;
            }

            // 성공 응답 처리
            const flowiseResponse = await response.json();
            console.log(`[Session: ${sessionId}] Received from Flowise:`, flowiseResponse);

            // Embed로 응답 구성
            let replyEmbeds = [];
            // 이미지 URL 확인 (Flowise 응답 구조에 따라 키 이름 확인 필요)
            const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);

            if (imageUrl) { // 이미지 응답 처리
                const imageEmbed = new EmbedBuilder()
                    .setTitle('AI가 생성한 이미지')
                    .setImage(imageUrl)
                    .setColor(0x0099FF);
                replyEmbeds.push(imageEmbed);
            }

            const replyText = flowiseResponse.text;
            if (replyText && !imageUrl) { // 텍스트 응답 처리
                const textEmbed = new EmbedBuilder()
                    .setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText)
                    .setColor(0x00FA9A) // MediumSpringGreen
                    .setTimestamp()
                    .setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });
                replyEmbeds.push(textEmbed);
            } else if (!imageUrl && !replyText) { // 응답 내용이 없는 경우
                 const errorEmbed = new EmbedBuilder()
                    .setDescription('죄송합니다, AI로부터 답변을 받지 못했습니다.')
                    .setColor(0xFF0000); // 빨간색
                 replyEmbeds.push(errorEmbed);
            }

            // 최종 응답 전송 (사용자 멘션 + Embed)
            const mentionString = `<@${interaction.user.id}>`;
            await interaction.editReply({ content: mentionString, embeds: replyEmbeds });

        } catch (error) { // Flowise API 호출 또는 응답 처리 중 예외 발생
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
        // 사용자 권한 확인
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
             return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
        }
        // 봇 권한 확인
        if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
            return interaction.reply({ content: '봇이 이벤트를 생성할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
        }


        try {
            await interaction.deferReply({ ephemeral: true }); // 명령어 사용자에게만 진행 상황 표시

            // 옵션 값 가져오기
            const eventName = interaction.options.getString('name');
            const eventDescription = interaction.options.getString('description');
            const startTimeString = interaction.options.getString('start_time');
            const eventChannel = interaction.options.getChannel('channel');

            // 시작 시간 처리 (KST 입력 -> UTC 변환)
            let scheduledStartTime;
            try {
                const dateParts = startTimeString.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})/);
                if (!dateParts) throw new Error("Invalid date format. Use 'YYYY-MM-DD HH:MM'");

                const year = parseInt(dateParts[1]);
                const month = parseInt(dateParts[2]) - 1; // JavaScript month is 0-indexed
                const day = parseInt(dateParts[3]);
                const hourKST = parseInt(dateParts[4]);
                const minute = parseInt(dateParts[5]);

                // 입력된 KST 시간을 기준으로 UTC 타임스탬프 계산
                const utcTimestamp = Date.UTC(year, month, day, hourKST - 9, minute);
                scheduledStartTime = new Date(utcTimestamp); // UTC 타임스탬프로 Date 객체 생성

                if (isNaN(scheduledStartTime.getTime())) throw new Error('Invalid date calculation');

                // Discord API는 미래 시간만 받으므로 확인
                if (scheduledStartTime < new Date()) {
                    return interaction.editReply('오류: 이벤트 시작 시간은 현재 시간 이후여야 합니다.');
                }
                console.log(`[Schedule] Parsed start time: ${startTimeString} KST -> ${scheduledStartTime.toISOString()} UTC`);

            } catch (e) {
                console.error("Date parsing error:", e);
                return interaction.editReply(`오류: 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요. (예: '2025-05-10 20:00')`);
            }

            // 이벤트 생성 옵션 구성
            const eventOptions = {
                name: eventName,
                description: eventDescription,
                scheduledStartTime: scheduledStartTime, // UTC 기준 Date 객체 전달
                privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                entityType: null, // 아래에서 설정
            };

            // 선택된 채널 타입에 따라 entityType 및 관련 정보 설정
            if (eventChannel.type === ChannelType.GuildStageVoice) {
                eventOptions.entityType = GuildScheduledEventEntityType.StageInstance;
                eventOptions.channel = eventChannel.id;
            } else if (eventChannel.type === ChannelType.GuildVoice) {
                eventOptions.entityType = GuildScheduledEventEntityType.Voice;
                eventOptions.channel = eventChannel.id;
            } else if (eventChannel.type === ChannelType.GuildText) {
                eventOptions.entityType = GuildScheduledEventEntityType.External;
                eventOptions.entityMetadata = { location: `#${eventChannel.name} 채널에서 진행` };
            } else {
                return interaction.editReply('오류: 지원하지 않는 채널 타입입니다.');
            }

            // 이벤트 생성 시도
            const createdEvent = await interaction.guild.scheduledEvents.create(eventOptions);

            console.log(`Event created: ${createdEvent.name} (ID: ${createdEvent.id})`);
            await interaction.editReply(`✅ 이벤트 "${createdEvent.name}"이(가) 성공적으로 생성되었습니다! (시작: ${startTimeString} KST)`); // 사용자 입력 시간 기준으로 안내

        } catch (error) { // 이벤트 생성 중 오류 발생
            console.error('Error creating scheduled event:', error);
            await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 입력값, 봇의 "이벤트 관리" 권한, 또는 채널 설정을 확인해주세요.');
        }
    }
    // --- 다른 슬래시 명령어 처리 ---
    else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("도움말")
            .setColor(0xFFD700) // 금색
            .setDescription('명령어: /chat [질문] [file:첨부파일], /help, /avatar, /server, /call, /create_event [옵션들]');
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

// 이 코드가 지금까지 논의된 모든 기능과 수정 사항을 포함한 최종 버전입니다. 환경 변수와 봇 권한을 다시 한번 확인하시고 배포하여 사용하시면 됩
