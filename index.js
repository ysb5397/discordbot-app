// discord.js v14 이상 필요
// 필요한 모든 모듈을 한 번에 불러옵니다.
const {
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder,
    InteractionType, Events, ChannelType, GuildScheduledEventPrivacyLevel,
    GuildScheduledEventEntityType, PermissionsBitField,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType
} = require('discord.js');
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config(); // .env 파일 로드

// v14 Intents 사용
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,             // 서버 관련 기본 이벤트 (상호작용 포함)
        GatewayIntentBits.GuildMessages,      // 메시지 관련 Intent (필요시)
        GatewayIntentBits.MessageContent,     // 메시지 내용 접근 Intent (Privileged, 필요시)
        GatewayIntentBits.GuildScheduledEvents  // 서버 이벤트 관련 Intent (필요시)
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

// --- 봇 이름 변수 ---
let botName = "AI Assistant"; // 기본값 설정

// --- 유틸리티 함수 ---
// 시간 문자열 파싱 함수 (KST -> UTC Date 객체) - *** 수정됨: 복잡한 검증 로직 제거 ***
function parseKSTDateTime(dateTimeString) {
    const dateParts = dateTimeString.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})$/);
    if (!dateParts) throw new Error("Invalid date format. Use 'YYYY-MM-DD HH:MM'");
    const year = parseInt(dateParts[1]);
    const month = parseInt(dateParts[2]) - 1;
    const day = parseInt(dateParts[3]);
    const hourKST = parseInt(dateParts[4]);
    const minute = parseInt(dateParts[5]);
    const utcTimestamp = Date.UTC(year, month, day, hourKST - 9, minute);
    const dateObject = new Date(utcTimestamp);
    if (isNaN(dateObject.getTime())) throw new Error('Invalid date calculation');
    return dateObject;
}


// --- 슬래시 명령어 정의 (모든 명령어 통합) ---
const commands = [
    // ... (다른 명령어 정의들은 이전과 동일하게 유지) ...
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
    new SlashCommandBuilder()
        .setName('deep_research')
        .setDescription('AI에게 심층 리서치를 요청합니다 (계획 확인 단계 포함).')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('리서치할 주제 또는 질문')
                .setRequired(true)),
    new SlashCommandBuilder().setName('help').setDescription('봇 도움말을 표시합니다.'),
    new SlashCommandBuilder().setName('avatar').setDescription('당신의 아바타 URL을 보여줍니다.'),
    new SlashCommandBuilder().setName('server').setDescription('서버 정보를 보여줍니다.'),
    new SlashCommandBuilder().setName('call').setDescription('콜백 메시지를 보냅니다.'),
    // ... (이벤트 관련 명령어 정의들도 이전과 동일하게 유지) ...
     new SlashCommandBuilder()
        .setName('create_event')
        .setDescription('서버 이벤트를 생성합니다.')
        .addStringOption(option => option.setName('name').setDescription('이벤트 이름').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('이벤트 설명').setRequired(true))
        .addStringOption(option => option.setName('start_time').setDescription("시작 시간 (예: '2025-05-10 20:00') - KST").setRequired(true))
        .addChannelOption(option => option.setName('channel').setDescription('이벤트 채널 (음성/스테이지/텍스트)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(true))
        .addStringOption(option => option.setName('end_time').setDescription("종료 시간 (예: '2025-05-10 22:00') - 텍스트 채널 시 필수").setRequired(false)),
    new SlashCommandBuilder()
        .setName('edit_event')
        .setDescription('기존 서버 이벤트를 수정합니다.')
        .addStringOption(option => option.setName('current_name').setDescription('수정할 이벤트의 현재 이름').setRequired(true))
        .addStringOption(option => option.setName('new_name').setDescription('새 이벤트 이름 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_description').setDescription('새 이벤트 설명 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_start_time').setDescription("새 시작 시간 (예: '2025-05-11 21:00') - KST").setRequired(false))
        .addChannelOption(option => option.setName('new_channel').setDescription('새 이벤트 채널 (선택 사항)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(false))
        .addStringOption(option => option.setName('new_end_time').setDescription("새 종료 시간 (예: '2025-05-11 23:00')").setRequired(false)),
    new SlashCommandBuilder()
        .setName('delete_event')
        .setDescription('서버 이벤트를 삭제합니다.')
        .addStringOption(option => option.setName('name').setDescription('삭제할 이벤트의 이름').setRequired(true))

].map(command => command.toJSON());

// --- 명령어 등록 로직 ---
const rest = new REST({ version: '10' }).setToken(discordToken);

(async () => {
    try {
        console.log('(/) 슬래시 명령어 등록 시작...');
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );
        console.log('(/) 슬래시 명령어가 성공적으로 등록되었습니다.');
    } catch (error) {
        console.error('(/) 슬래시 명령어 등록 중 오류 발생:', error);
    }
})();


// --- 유틸리티 함수 (sleep) ---
const sleep = (ms) => { return new Promise((r) => setTimeout(r, ms)); }

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
    // 봇 준비 완료 시 봇 이름 업데이트
    if (client.user && client.user.username) {
        botName = client.user.username;
        console.log(`Bot name set to: ${botName}`);
    } else {
        console.warn("봇 사용자 정보를 가져올 수 없어 기본 이름 'AI Assistant'를 사용합니다.");
    }
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

// --- 임시 저장소 (간단한 예시) ---
const pendingResearch = new Map();

// --- 슬래시 명령어 및 버튼 상호작용 처리 핸들러 ---
client.on(Events.InteractionCreate, async interaction => {

    // --- 슬래시 명령어 처리 ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        console.log(`Processing slash command: /${commandName} by ${interaction.user.tag}`);

        // --- /chat 명령어 처리 ---
        if (commandName === 'chat') {
            // ... (이전 /chat 처리 로직과 동일) ...
            // *** 수정 시작: console.log 추가 ***
            if (interaction.deferred || interaction.replied) return;
            try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

            const userQuestion = interaction.options.getString('question');
            const sessionId = interaction.user.id;
            const attachment = interaction.options.getAttachment('file');

            // ***** 추가된 디버그 로그 *****
            console.log(`[/chat] Flowise 요청 전 botName 변수 값: ${botName}`);

            const requestBody = {
                question: userQuestion,
                overrideConfig: { sessionId: sessionId, vars: { bot_name: botName } }
            };
            if (attachment) {
                requestBody.uploads = [{ type: 'url', name: attachment.name, mime: attachment.contentType || 'application/octet-stream', data: attachment.url }];
            }

            // ***** 추가된 디버그 로그 *****
            console.log(`[/chat Session: ${sessionId}] Sending to Flowise (Body):`, JSON.stringify(requestBody, null, 2));

            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });
                 // ... (이후 응답 처리 로직은 동일) ...
                 if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`[/chat Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                    return;
                }
                const flowiseResponse = await response.json();
                console.log(`[/chat Session: ${sessionId}] Received from Flowise:`, flowiseResponse);

                let replyEmbeds = [];
                const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);
                if (imageUrl) {
                     const imageEmbed = new EmbedBuilder().setTitle('AI가 생성한 이미지').setImage(imageUrl).setColor(0x0099FF);
                     replyEmbeds.push(imageEmbed);
                }
                const replyText = flowiseResponse.text;
                 if (replyText && !imageUrl) {
                    const textEmbed = new EmbedBuilder().setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText).setColor(0x00FA9A).setTimestamp().setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });
                    replyEmbeds.push(textEmbed);
                 } else if (!imageUrl && !replyText) {
                    const errorEmbed = new EmbedBuilder().setDescription('죄송합니다, AI로부터 답변을 받지 못했습니다.').setColor(0xFF0000);
                    replyEmbeds.push(errorEmbed);
                 }
                 await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: replyEmbeds });

            } catch (error) {
                console.error(`[/chat Session: ${sessionId}] Error processing Flowise request:`, error);
                try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
            }
            // *** 수정 끝 ***
        }
        // --- /deep_research 명령어 처리 (1단계: 계획 요청) ---
        else if (commandName === 'deep_research') {
            // ... (이전 /deep_research 계획 요청 로직과 동일) ...
             // *** 수정 시작: console.log 추가 ***
            if (interaction.deferred || interaction.replied) return;
            try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

            const userQuestion = interaction.options.getString('question');
            const sessionId = interaction.user.id;

            // ***** 추가된 디버그 로그 *****
            console.log(`[/deep_research Plan] Flowise 요청 전 botName 변수 값: ${botName}`);

            const requestBody = {
                question: userQuestion,
                overrideConfig: {
                    sessionId: sessionId,
                    vars: { bot_name: botName },
                    flowise_request_type: 'request_plan' // Flowise에 계획 요청임을 알림
                },
                streaming: true // 스트리밍 사용 여부 (필요시)
            };

            // ***** 추가된 디버그 로그 *****
            console.log(`[/deep_research Plan Request Session: ${sessionId}] Sending PLAN request to Flowise (Body):`, JSON.stringify(requestBody, null, 2));

            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });
                 // ... (이후 계획 응답 처리 및 버튼 생성 로직은 동일) ...
                if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`[/deep_research Plan Request Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 리서치 계획 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                    return;
                }

                const flowiseResponse = await response.json();
                console.log(`[/deep_research Plan Request Session: ${sessionId}] Received PLAN from Flowise:`, flowiseResponse);

                const researchPlanText = flowiseResponse.plan || flowiseResponse.text;

                if (!researchPlanText) {
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI로부터 리서치 계획을 받지 못했습니다.`);
                    return;
                }

                pendingResearch.set(interaction.id, { originalQuestion: userQuestion, sessionId: sessionId });

                const confirmButton = new ButtonBuilder()
                    .setCustomId(`confirm_research_${interaction.id}`)
                    .setLabel('계획대로 진행')
                    .setStyle(ButtonStyle.Success);

                const cancelButton = new ButtonBuilder()
                    .setCustomId(`cancel_research_${interaction.id}`)
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Danger);

                const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                const planEmbed = new EmbedBuilder()
                    .setTitle("🔍 심층 리서치 계획 제안")
                    .setDescription(researchPlanText)
                    .setColor(0x5865F2)
                    .setFooter({ text: "아래 버튼을 눌러 진행 여부를 선택해주세요." });

                await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: [planEmbed], components: [row] });

            } catch (error) {
                console.error(`[/deep_research Plan Request Session: ${sessionId}] Error processing Flowise request:`, error);
                 try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 리서치 계획 요청 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
            }
            // *** 수정 끝 ***
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
                await interaction.deferReply({ ephemeral: true });

                // 옵션 값 가져오기
                const eventName = interaction.options.getString('name');
                const eventDescription = interaction.options.getString('description');
                const startTimeString = interaction.options.getString('start_time');
                const eventChannel = interaction.options.getChannel('channel');
                const endTimeString = interaction.options.getString('end_time');

                // 시작 시간 처리 (KST 입력 -> UTC 변환)
                let scheduledStartTime;
                try {
                    // 수정된 parseKSTDateTime 함수 사용
                    scheduledStartTime = parseKSTDateTime(startTimeString);
                    if (scheduledStartTime < new Date()) { // 현재 시간보다 이전인지 확인
                        return interaction.editReply('오류: 이벤트 시작 시간은 현재 시간 이후여야 합니다.');
                    }
                    console.log(`[Schedule Create] Parsed start time: ${startTimeString} KST -> ${scheduledStartTime.toISOString()} UTC`);
                } catch (e) {
                    console.error("Start Date parsing error:", e);
                    // 사용자에게 명확한 형식 안내
                    return interaction.editReply(`오류: 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요. (예: '2025-05-10 20:00')`);
                }

                // 종료 시간 처리
                let scheduledEndTime = null;
                if (endTimeString) {
                    try {
                        // 수정된 parseKSTDateTime 함수 사용
                        scheduledEndTime = parseKSTDateTime(endTimeString);
                        // 종료 시간이 시작 시간보다 이전이거나 같은지 확인
                        if (scheduledEndTime <= scheduledStartTime) {
                            return interaction.editReply('오류: 이벤트 종료 시간은 시작 시간 이후여야 합니다.');
                        }
                        console.log(`[Schedule Create] Parsed end time: ${endTimeString} KST -> ${scheduledEndTime.toISOString()} UTC`);
                    } catch (e) {
                        console.error("End Date parsing error:", e);
                        // 사용자에게 명확한 형식 안내
                        return interaction.editReply(`오류: 종료 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                    }
                }

                // 이벤트 생성 옵션 구성
                const eventOptions = {
                    name: eventName,
                    description: eventDescription,
                    scheduledStartTime: scheduledStartTime, // UTC 기준 Date 객체
                    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, // 서버 멤버만 볼 수 있도록 설정
                    entityType: null, // 채널 타입에 따라 설정됨
                    // entityMetadata는 External 타입일 때만 사용
                };

                // 채널 타입에 따라 entityType 및 관련 정보 설정
                if (eventChannel.type === ChannelType.GuildStageVoice) {
                    eventOptions.entityType = GuildScheduledEventEntityType.StageInstance;
                    eventOptions.channel = eventChannel.id; // 스테이지 채널 ID 설정
                    if (scheduledEndTime) eventOptions.scheduledEndTime = scheduledEndTime; // 종료 시간 설정 (선택)
                } else if (eventChannel.type === ChannelType.GuildVoice) {
                    eventOptions.entityType = GuildScheduledEventEntityType.Voice;
                    eventOptions.channel = eventChannel.id; // 음성 채널 ID 설정
                    if (scheduledEndTime) eventOptions.scheduledEndTime = scheduledEndTime; // 종료 시간 설정 (선택)
                } else if (eventChannel.type === ChannelType.GuildText) {
                    eventOptions.entityType = GuildScheduledEventEntityType.External; // 외부 이벤트로 설정
                    eventOptions.entityMetadata = { location: `#${eventChannel.name} 채널에서 진행` }; // 위치 정보 설정
                    // External 타입일 경우 종료 시간 필수
                    if (!scheduledEndTime) {
                        return interaction.editReply('오류: 텍스트 채널을 이벤트 장소로 지정할 경우, 반드시 종료 시간(`end_time` 옵션)을 입력해야 합니다.');
                    }
                    eventOptions.scheduledEndTime = scheduledEndTime; // 종료 시간 설정 (필수)
                } else {
                    // 지원하지 않는 채널 타입 처리
                    return interaction.editReply('오류: 지원하지 않는 채널 타입입니다. (음성, 스테이지, 텍스트 채널만 가능)');
                }

                // 이벤트 생성 시도
                const createdEvent = await interaction.guild.scheduledEvents.create(eventOptions);

                console.log(`Event created: ${createdEvent.name} (ID: ${createdEvent.id})`);
                // 사용자에게 성공 메시지 표시 (KST 기준 시간 포함)
                await interaction.editReply(`✅ 이벤트 "${createdEvent.name}"이(가) 성공적으로 생성되었습니다! (시작: ${startTimeString} KST${endTimeString ? `, 종료: ${endTimeString} KST` : ''})`);

            } catch (error) { // 이벤트 생성 중 오류 발생
                console.error('Error creating scheduled event:', error);
                // Discord API 오류 코드에 따른 분기 처리
                if (error.code === 50035 && error.message.includes('scheduled_end_time')) {
                     // 종료 시간 관련 오류 (주로 External 타입인데 종료 시간 누락 시)
                     await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 텍스트 채널을 선택한 경우 종료 시간이 필요합니다.');
                } else {
                     // 기타 오류 (권한 부족, 잘못된 입력 등)
                     await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 입력값, 봇 권한, 채널 설정을 확인해주세요.');
                }
            }
        }
        // --- /edit_event 명령어 처리 ---
        else if (commandName === 'edit_event') {
            // 권한 확인
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
                 return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
            }
            if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
                return interaction.reply({ content: '봇이 이벤트를 수정할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
            }

            try {
                await interaction.deferReply({ ephemeral: true });

                const currentName = interaction.options.getString('current_name');
                const newName = interaction.options.getString('new_name');
                const newDescription = interaction.options.getString('new_description');
                const newStartTimeString = interaction.options.getString('new_start_time');
                const newChannel = interaction.options.getChannel('new_channel');
                const newEndTimeString = interaction.options.getString('new_end_time');

                // 이름으로 이벤트 찾기 (대소문자 구분 없이)
                const events = await interaction.guild.scheduledEvents.fetch();
                const targetEvents = events.filter(event => event.name.toLowerCase() === currentName.toLowerCase());

                if (targetEvents.size === 0) {
                    return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트를 찾을 수 없습니다.`);
                }
                if (targetEvents.size > 1) {
                    // 중복 이름 처리: 사용자에게 ID로 다시 시도하도록 안내 (ID 기반 수정은 아직 구현 안 됨)
                    const eventList = targetEvents.map((event, id) => ` - ${event.name} (ID: ${id})`).join('\n');
                    return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트가 여러 개 있습니다. 더 구체적인 이름이나 ID로 수정해주세요.\n발견된 이벤트:\n${eventList}\n(ID 기반 수정은 아직 지원되지 않습니다.)`);
                }

                const eventToEdit = targetEvents.first();
                const editOptions = {}; // 수정할 옵션만 담을 객체

                // 각 옵션이 입력되었는지 확인하고 editOptions에 추가
                if (newName) editOptions.name = newName;
                if (newDescription) editOptions.description = newDescription;

                // 시작 시간 수정 처리
                if (newStartTimeString) {
                    try {
                        // 수정된 parseKSTDateTime 함수 사용
                        editOptions.scheduledStartTime = parseKSTDateTime(newStartTimeString);
                        if (editOptions.scheduledStartTime < new Date()) { // 현재 시간보다 이전인지 확인
                            return interaction.editReply('오류: 새 시작 시간은 현재 시간 이후여야 합니다.');
                        }
                        console.log(`[Schedule Edit] Parsed new start time: ${newStartTimeString} KST -> ${editOptions.scheduledStartTime.toISOString()} UTC`);
                    } catch (e) {
                        console.error("New Start Date parsing error:", e);
                        return interaction.editReply(`오류: 새 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                    }
                }

                // 종료 시간 수정 처리
                let newScheduledEndTime = null;
                if (newEndTimeString) {
                    try {
                        // 수정된 parseKSTDateTime 함수 사용
                        newScheduledEndTime = parseKSTDateTime(newEndTimeString);
                        // 수정될 시작 시간 또는 기존 시작 시간과 비교
                        const startTimeToCheck = editOptions.scheduledStartTime || eventToEdit.scheduledStartAt;
                        if (newScheduledEndTime <= startTimeToCheck) {
                            return interaction.editReply('오류: 새 종료 시간은 시작 시간 이후여야 합니다.');
                        }
                        editOptions.scheduledEndTime = newScheduledEndTime; // 수정 옵션에 추가
                        console.log(`[Schedule Edit] Parsed new end time: ${newEndTimeString} KST -> ${editOptions.scheduledEndTime.toISOString()} UTC`);
                    } catch (e) {
                        console.error("New End Date parsing error:", e);
                        return interaction.editReply(`오류: 새 종료 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                    }
                }

                // 채널/위치 수정 처리
                if (newChannel) {
                    if (newChannel.type === ChannelType.GuildStageVoice) {
                        editOptions.entityType = GuildScheduledEventEntityType.StageInstance;
                        editOptions.channel = newChannel.id;
                        editOptions.entityMetadata = null; // 외부 위치 정보 제거
                    } else if (newChannel.type === ChannelType.GuildVoice) {
                        editOptions.entityType = GuildScheduledEventEntityType.Voice;
                        editOptions.channel = newChannel.id;
                        editOptions.entityMetadata = null; // 외부 위치 정보 제거
                    } else if (newChannel.type === ChannelType.GuildText) {
                        editOptions.entityType = GuildScheduledEventEntityType.External;
                        editOptions.entityMetadata = { location: `#${newChannel.name} 채널에서 진행` };
                        editOptions.channel = null; // 채널 ID 제거
                        // 외부 이벤트로 변경 시 종료 시간 확인 (수정 옵션 또는 기존 이벤트에서)
                        const endTimeToCheck = editOptions.scheduledEndTime || eventToEdit.scheduledEndAt;
                        if (!endTimeToCheck) {
                            // 새 종료 시간도 없고 기존 종료 시간도 없으면 오류
                            return interaction.editReply('오류: 이벤트 장소를 텍스트 채널(외부)로 변경하려면 종료 시간이 필요합니다. `new_end_time` 옵션도 함께 입력해주세요.');
                        }
                        // 종료 시간이 이미 설정되어 있다면 editOptions에 포함됨 (위에서 처리)
                    } else {
                        return interaction.editReply('오류: 지원하지 않는 채널 타입입니다.');
                    }
                } else if (eventToEdit.entityType === GuildScheduledEventEntityType.External) {
                     // 기존 이벤트가 External 타입인데, 채널 변경 없이 종료 시간만 수정하는 경우
                     // 또는 채널 변경 없이 아무것도 수정 안 하는 경우
                     // 이 경우, 종료 시간이 반드시 있어야 함 (수정 옵션 또는 기존 값)
                     const endTimeToCheck = editOptions.scheduledEndTime || eventToEdit.scheduledEndAt;
                     if (!endTimeToCheck) {
                         // 새 종료 시간도 없고 기존 종료 시간도 없으면 오류
                         return interaction.editReply('오류: 외부 이벤트에는 종료 시간이 필요합니다. `new_end_time` 옵션을 입력해주세요.');
                     }
                     // editOptions에 종료 시간이 없다면, 기존 종료 시간을 유지해야 함 (edit 호출 시 자동으로 유지됨)
                }


                // 수정할 내용이 있는지 확인
                if (Object.keys(editOptions).length === 0) {
                    return interaction.editReply('수정할 내용을 하나 이상 입력해주세요.');
                }

                // 이벤트 수정 시도
                const updatedEvent = await eventToEdit.edit(editOptions);

                console.log(`Event updated: ${updatedEvent.name} (ID: ${updatedEvent.id})`);
                await interaction.editReply(`✅ 이벤트 "${currentName}"이(가) 성공적으로 수정되었습니다! (새 이름: ${updatedEvent.name})`);

            } catch (error) { // 이벤트 수정 중 오류 발생
                console.error('Error editing scheduled event:', error);
                 // Discord API 오류 코드에 따른 분기 처리
                if (error.code === 50035) { // Invalid Form Body 오류
                     if (error.message.includes('scheduled_end_time')) {
                         await interaction.editReply('❌ 이벤트 수정 중 오류: 외부 이벤트에는 종료 시간이 필요합니다.');
                     } else if (error.message.includes('scheduled_start_time')) {
                         await interaction.editReply('❌ 이벤트 수정 중 오류: 시작 시간은 현재 시간 이후여야 합니다.');
                     } else {
                        // 기타 Form Body 오류
                        await interaction.editReply('❌ 이벤트 수정 중 오류가 발생했습니다. 입력값을 확인해주세요.');
                     }
                } else if (error.code === 50013) { // Missing Permissions 오류
                     await interaction.editReply('❌ 이벤트 수정 중 오류: 봇이 이벤트를 수정할 권한이 없습니다.');
                }
                else {
                    // 기타 예상치 못한 오류
                    await interaction.editReply('❌ 이벤트를 수정하는 중 오류가 발생했습니다. 입력값이나 봇 권한을 확인해주세요.');
                }
            }
        }
        // --- /delete_event 명령어 처리 ---
        else if (commandName === 'delete_event') {
            // 권한 확인
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
                 return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
            }
            if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
                return interaction.reply({ content: '봇이 이벤트를 삭제할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
            }

            try {
                await interaction.deferReply({ ephemeral: true });

                const eventName = interaction.options.getString('name');

                // 이름으로 이벤트 찾기 (대소문자 구분 없이)
                const events = await interaction.guild.scheduledEvents.fetch();
                const targetEvents = events.filter(event => event.name.toLowerCase() === eventName.toLowerCase());

                if (targetEvents.size === 0) {
                    return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트를 찾을 수 없습니다.`);
                }
                if (targetEvents.size > 1) {
                     // 중복 이름 처리: 사용자에게 ID로 다시 시도하도록 안내
                     const eventList = targetEvents.map((event, id) => ` - ${event.name} (ID: ${id})`).join('\n');
                    return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트가 여러 개 발견되었습니다. 삭제할 이벤트의 ID를 사용하여 다시 시도해주세요.\n발견된 이벤트:\n${eventList}\n(ID 기반 삭제는 아직 지원되지 않습니다.)`);
                }

                const eventToDelete = targetEvents.first();

                // 이벤트 삭제 시도
                await interaction.guild.scheduledEvents.delete(eventToDelete.id);

                console.log(`Event deleted: ${eventToDelete.name} (ID: ${eventToDelete.id})`);
                await interaction.editReply(`✅ 이벤트 "${eventName}"이(가) 성공적으로 삭제되었습니다!`);

            } catch (error) { // 이벤트 삭제 중 오류 발생
                console.error('Error deleting scheduled event:', error);
                // Discord API 오류 코드에 따른 분기 처리
                if (error.code === 50013) { // Missing Permissions 오류
                     await interaction.editReply('❌ 이벤트 삭제 중 오류: 봇이 이벤트를 삭제할 권한이 없습니다.');
                } else if (error.code === 10062) { // Unknown Interaction or Event 오류 (이미 삭제되었거나 존재하지 않음)
                     await interaction.editReply('❌ 이벤트 삭제 중 오류: 해당 이벤트를 찾을 수 없거나 이미 삭제되었습니다.');
                }
                else {
                    // 기타 예상치 못한 오류
                    await interaction.editReply('❌ 이벤트를 삭제하는 중 오류가 발생했습니다.');
                }
            }
        }
        // --- 다른 슬래시 명령어 처리 ---
        else if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle("도움말").setColor(0xFFD700).setDescription('명령어: /chat [질문] [file:첨부파일], /deep_research [질문], /help, /avatar, /server, /call, /create_event [옵션들], /edit_event [옵션들], /delete_event [이름]');
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        else if (commandName === 'avatar') { await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true }); }
        else if (commandName === 'server') { await interaction.reply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`); }
        else if (commandName === 'call') { await interaction.reply(`<@${interaction.user.id}> !callback`); }
        // 이벤트 관련 명령어는 위에서 이미 처리됨
        // else if (commandName === 'create_event') { /* ... */ }
        // else if (commandName === 'edit_event') { /* ... */ }
        // else if (commandName === 'delete_event') { /* ... */ }

    }
    // --- 버튼 상호작용 처리 ---
    else if (interaction.isButton()) {
        const customId = interaction.customId;
        console.log(`Processing button interaction: ${customId} by ${interaction.user.tag}`);

        // --- 심층 리서치 확인 버튼 처리 ---
        if (customId.startsWith('confirm_research_')) {
           // ... (이전 리서치 확인 버튼 로직과 동일) ...
           // *** 수정 시작: console.log 추가 ***
            const originalInteractionId = customId.replace('confirm_research_', '');
            const researchData = pendingResearch.get(originalInteractionId);

            if (!researchData || interaction.user.id !== researchData.sessionId) {
                await interaction.reply({ content: "이 확인 버튼은 당신의 것이 아니거나 만료되었습니다.", ephemeral: true });
                return;
            }

            try {
                await interaction.update({ content: `<@${interaction.user.id}>\n리서치를 진행합니다... 잠시만 기다려주세요.`, embeds: interaction.message.embeds, components: [] });
            } catch (updateError) {
                console.error("Failed to update interaction message:", updateError);
            }

            const { originalQuestion, sessionId } = researchData;

             // ***** 추가된 디버그 로그 *****
            console.log(`[/deep_research Execute] Flowise 요청 전 botName 변수 값: ${botName}`);

            const requestBody = {
                question: `계획대로 \"${originalQuestion}\"에 대한 심층 리서치를 진행해 주세요.`,
                overrideConfig: {
                    sessionId: sessionId,
                    vars: { bot_name: botName },
                    flowise_request_type: 'execute_research'
                }
            };

             // ***** 추가된 디버그 로그 *****
            console.log(`[/deep_research Execute Session: ${sessionId}] Sending EXECUTE request to Flowise (Body):`, JSON.stringify(requestBody, null, 2));

            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });

                 // ... (이후 리서치 결과 처리 로직은 동일) ...
                 if (!response.ok) {
                     const errorData = await response.text();
                     console.error(`[/deep_research Execute Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                     await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, 리서치 실행 중 오류가 발생했습니다. (Code: ${response.status})`, ephemeral: true });
                     pendingResearch.delete(originalInteractionId);
                     return;
                }

                const flowiseResponse = await response.json();
                console.log(`[/deep_research Execute Session: ${sessionId}] Received RESULT from Flowise:`, flowiseResponse);

                let replyEmbeds = [];
                const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);
                 if (imageUrl) {
                      const imageEmbed = new EmbedBuilder().setTitle('리서치 관련 이미지').setImage(imageUrl).setColor(0x0099FF);
                      replyEmbeds.push(imageEmbed);
                 }
                const replyText = flowiseResponse.text;
                if (replyText && !imageUrl) {
                    const textEmbed = new EmbedBuilder()
                        .setTitle(`'${originalQuestion}'에 대한 심층 리서치 결과`)
                        .setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText)
                        .setColor(0x00FA9A)
                        .setTimestamp()
                        .setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });
                    replyEmbeds.push(textEmbed);
                } else if (!imageUrl && !replyText) {
                    const errorEmbed = new EmbedBuilder().setDescription('죄송합니다, AI로부터 리서치 결과를 받지 못했습니다.').setColor(0xFF0000);
                    replyEmbeds.push(errorEmbed);
                }

                await interaction.followUp({ content: `<@${interaction.user.id}>`, embeds: replyEmbeds });
                pendingResearch.delete(originalInteractionId);

            } catch (error) {
                 console.error(`[/deep_research Execute Session: ${sessionId}] Error processing Flowise request:`, error);
                 try {
                     await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, 리서치 결과 처리 중 오류가 발생했습니다.`, ephemeral: true });
                 } catch (e) {
                     console.error("FollowUp failed after error:", e);
                 }
                 pendingResearch.delete(originalInteractionId);
            }
             // *** 수정 끝 ***
        }
        // --- 심층 리서치 취소 버튼 처리 ---
        else if (customId.startsWith('cancel_research_')) {
            // ... (취소 버튼 로직은 이전과 동일하게 유지) ...
             const originalInteractionId = customId.replace('cancel_research_', '');
            const researchData = pendingResearch.get(originalInteractionId);

            if (!researchData || interaction.user.id !== researchData.sessionId) {
                await interaction.reply({ content: "이 취소 버튼은 당신의 것이 아니거나 만료되었습니다.", ephemeral: true });
                return;
            }

            await interaction.update({ content: `<@${interaction.user.id}>\n심층 리서치 요청이 취소되었습니다.`, embeds: interaction.message.embeds, components: [] });
            pendingResearch.delete(originalInteractionId);
        }
    }
});

// --- 기존 메시지 기반 명령어 처리 (주석 처리 또는 제거 권장) ---
/*
client.on('messageCreate', async msg => {
    // 슬래시 명령어를 사용하는 것이 좋습니다.
});
*/
