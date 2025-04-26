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
        GatewayIntentBits.GuildMessages, // 메시지 기반 명령어가 없다면 제거 가능
        GatewayIntentBits.MessageContent, // 메시지 기반 명령어가 없다면 제거 가능
        GatewayIntentBits.GuildScheduledEvents // 이벤트 관련 기능에 필요할 수 있음
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

// --- 봇 이름 변수 ---
let botName = "AI Assistant"; // 기본 이름 (봇이 로그인하기 전까지 사용될 값)

// --- 유틸리티 함수 ---
// 시간 문자열 파싱 함수 (KST -> UTC Date 객체)
function parseKSTDateTime(dateTimeString) {
    // YYYY-MM-DD HH:MM 형식 확인
    const dateParts = dateTimeString.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})$/);
    if (!dateParts) throw new Error("Invalid date format. Use 'YYYY-MM-DD HH:MM'");

    const year = parseInt(dateParts[1]);
    const month = parseInt(dateParts[2]) - 1; // JavaScript month is 0-indexed
    const day = parseInt(dateParts[3]);
    const hourKST = parseInt(dateParts[4]);
    const minute = parseInt(dateParts[5]);

    // 입력된 KST 시간을 기준으로 UTC 타임스탬프 계산
    // KST는 UTC+9 이므로, UTC 시간은 KST 시간보다 9시간 느림
    const utcTimestamp = Date.UTC(year, month, day, hourKST - 9, minute);
    const dateObject = new Date(utcTimestamp); // UTC 타임스탬프로 Date 객체 생성

    // 유효한 날짜인지 확인
    if (isNaN(dateObject.getTime())) throw new Error('Invalid date calculation');
    // 생성된 Date 객체가 원래 입력과 일치하는지 추가 확인 (월 자동 변경 등 방지)
    if (dateObject.getUTCFullYear() !== year ||
        dateObject.getUTCMonth() !== month ||
        dateObject.getUTCDate() !== day ||
        dateObject.getUTCHours() !== (hourKST - 9 + 24) % 24 || // 시간 보정 후 비교
        dateObject.getUTCMinutes() !== minute) {
        throw new Error('Invalid date components after UTC conversion');
    }

    return dateObject;
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
        .addStringOption(option => option.setName('name').setDescription('이벤트 이름').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('이벤트 설명').setRequired(true))
        .addStringOption(option => option.setName('start_time').setDescription("시작 시간 (예: '2025-05-10 20:00') - KST").setRequired(true))
        .addChannelOption(option => option.setName('channel').setDescription('이벤트 채널 (음성/스테이지/텍스트)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(true))
        .addStringOption(option => option.setName('end_time').setDescription("종료 시간 (예: '2025-05-10 22:00') - 텍스트 채널 시 필수").setRequired(false)),
    // /edit_event 명령어
    new SlashCommandBuilder()
        .setName('edit_event')
        .setDescription('기존 서버 이벤트를 수정합니다.')
        .addStringOption(option => option.setName('current_name').setDescription('수정할 이벤트의 현재 이름').setRequired(true)) // 이름으로 이벤트 식별
        .addStringOption(option => option.setName('new_name').setDescription('새 이벤트 이름 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_description').setDescription('새 이벤트 설명 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_start_time').setDescription("새 시작 시간 (예: '2025-05-11 21:00') - KST").setRequired(false))
        .addChannelOption(option => option.setName('new_channel').setDescription('새 이벤트 채널 (선택 사항)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(false))
        .addStringOption(option => option.setName('new_end_time').setDescription("새 종료 시간 (예: '2025-05-11 23:00')").setRequired(false)),
    // /delete_event 명령어
    new SlashCommandBuilder()
        .setName('delete_event')
        .setDescription('서버 이벤트를 삭제합니다.')
        .addStringOption(option => option.setName('name').setDescription('삭제할 이벤트의 이름').setRequired(true)) // 이름으로 이벤트 식별

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
    // *** 봇 이름 변수 업데이트 ***
    botName = client.user.username; // 실제 봇 사용자 이름으로 업데이트
    console.log(`Bot name set to: ${botName}`); // 로그 추가 (확인용)
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

// --- 슬래시 명령어 처리 핸들러 ---
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
            // defer 실패 시 사용자에게 알림 (선택적)
            // await interaction.followUp({ content: '명령 처리 시작에 실패했습니다. 잠시 후 다시 시도해주세요.', ephemeral: true });
            return;
        }

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id; // 사용자 ID를 세션 ID로 사용
        const attachment = interaction.options.getAttachment('file');

        // Flowise API 요청 본문 구성
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId,
                // *** vars 객체 추가하여 봇 이름 전달 ***
                vars: {
                    bot_name: botName // 로그인 후 설정된 봇 이름 사용
                }
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
                // timeout 설정 고려 (예: 30초)
                // signal: AbortSignal.timeout(30000) // node-fetch v3+ 또는 다른 라이브러리 필요
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
                    .setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText) // Embed Description 길이 제한
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
                scheduledStartTime = parseKSTDateTime(startTimeString);
                if (scheduledStartTime < new Date()) {
                    return interaction.editReply('오류: 이벤트 시작 시간은 현재 시간 이후여야 합니다.');
                }
                console.log(`[Schedule Create] Parsed start time: ${startTimeString} KST -> ${scheduledStartTime.toISOString()} UTC`);
            } catch (e) {
                console.error("Start Date parsing error:", e);
                return interaction.editReply(`오류: 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요. (예: '2025-05-10 20:00')`);
            }

            // 종료 시간 처리
            let scheduledEndTime = null;
            if (endTimeString) {
                try {
                    scheduledEndTime = parseKSTDateTime(endTimeString);
                    if (scheduledEndTime <= scheduledStartTime) {
                        return interaction.editReply('오류: 이벤트 종료 시간은 시작 시간 이후여야 합니다.');
                    }
                    console.log(`[Schedule Create] Parsed end time: ${endTimeString} KST -> ${scheduledEndTime.toISOString()} UTC`);
                } catch (e) {
                    console.error("End Date parsing error:", e);
                    return interaction.editReply(`오류: 종료 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                }
            }

            // 이벤트 생성 옵션 구성
            const eventOptions = {
                name: eventName,
                description: eventDescription,
                scheduledStartTime: scheduledStartTime, // UTC 기준 Date 객체
                privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                entityType: null,
            };

            // 채널 타입에 따라 entityType 및 관련 정보 설정
            if (eventChannel.type === ChannelType.GuildStageVoice) {
                eventOptions.entityType = GuildScheduledEventEntityType.StageInstance;
                eventOptions.channel = eventChannel.id;
                if (scheduledEndTime) eventOptions.scheduledEndTime = scheduledEndTime;
            } else if (eventChannel.type === ChannelType.GuildVoice) {
                eventOptions.entityType = GuildScheduledEventEntityType.Voice;
                eventOptions.channel = eventChannel.id;
                if (scheduledEndTime) eventOptions.scheduledEndTime = scheduledEndTime;
            } else if (eventChannel.type === ChannelType.GuildText) {
                eventOptions.entityType = GuildScheduledEventEntityType.External;
                eventOptions.entityMetadata = { location: `#${eventChannel.name} 채널에서 진행` };
                // External 타입일 경우 종료 시간 필수
                if (!scheduledEndTime) {
                    return interaction.editReply('오류: 텍스트 채널을 이벤트 장소로 지정할 경우, 반드시 종료 시간(`end_time` 옵션)을 입력해야 합니다.');
                }
                eventOptions.scheduledEndTime = scheduledEndTime;
            } else {
                return interaction.editReply('오류: 지원하지 않는 채널 타입입니다.');
            }

            // 이벤트 생성 시도
            const createdEvent = await interaction.guild.scheduledEvents.create(eventOptions);

            console.log(`Event created: ${createdEvent.name} (ID: ${createdEvent.id})`);
            await interaction.editReply(`✅ 이벤트 "${createdEvent.name}"이(가) 성공적으로 생성되었습니다! (시작: ${startTimeString} KST${endTimeString ? `, 종료: ${endTimeString} KST` : ''})`);

        } catch (error) { // 이벤트 생성 중 오류 발생
            console.error('Error creating scheduled event:', error);
            if (error.code === 50035 && error.message.includes('scheduled_end_time')) {
                 await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 텍스트 채널을 선택한 경우 종료 시간이 필요합니다.');
            } else {
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

            // 이름으로 이벤트 찾기 (중복 가능성)
            const events = await interaction.guild.scheduledEvents.fetch();
            const targetEvents = events.filter(event => event.name === currentName);

            if (targetEvents.size === 0) {
                return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트를 찾을 수 없습니다.`);
            }
            if (targetEvents.size > 1) {
                return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트가 여러 개 있습니다. 더 구체적인 이름이나 ID로 수정해주세요.`);
            }

            const eventToEdit = targetEvents.first();
            const editOptions = {}; // 수정할 옵션만 담을 객체

            // 각 옵션이 입력되었는지 확인하고 editOptions에 추가
            if (newName) editOptions.name = newName;
            if (newDescription) editOptions.description = newDescription;

            // 시작 시간 수정 처리
            if (newStartTimeString) {
                try {
                    editOptions.scheduledStartTime = parseKSTDateTime(newStartTimeString);
                    if (editOptions.scheduledStartTime < new Date()) {
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
                    newScheduledEndTime = parseKSTDateTime(newEndTimeString);
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
                    editOptions.entityMetadata = null;
                } else if (newChannel.type === ChannelType.GuildVoice) {
                    editOptions.entityType = GuildScheduledEventEntityType.Voice;
                    editOptions.channel = newChannel.id;
                    editOptions.entityMetadata = null;
                } else if (newChannel.type === ChannelType.GuildText) {
                    editOptions.entityType = GuildScheduledEventEntityType.External;
                    editOptions.entityMetadata = { location: `#${newChannel.name} 채널에서 진행` };
                    editOptions.channel = null;
                    // 외부 이벤트로 변경 시 종료 시간 확인 (수정 옵션 또는 기존 이벤트에서)
                    const endTimeToCheck = editOptions.scheduledEndTime || eventToEdit.scheduledEndAt;
                    if (!endTimeToCheck) {
                        return interaction.editReply('오류: 이벤트 장소를 텍스트 채널(외부)로 변경하려면 종료 시간이 필요합니다. `new_end_time` 옵션도 함께 입력해주세요.');
                    }
                    // 종료 시간이 이미 설정되어 있다면 editOptions에 포함됨
                } else {
                    return interaction.editReply('오류: 지원하지 않는 채널 타입입니다.');
                }
            } else if (eventToEdit.entityType === GuildScheduledEventEntityType.External) {
                 // 외부 이벤트인데 채널 변경 없이 종료 시간도 수정 안 할 경우, 기존 종료 시간은 있는지 확인
                 const endTimeToCheck = editOptions.scheduledEndTime || eventToEdit.scheduledEndAt;
                 if (!endTimeToCheck) {
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
            if (error.code === 50035) { // Invalid Form Body
                 if (error.message.includes('scheduled_end_time')) {
                     await interaction.editReply('❌ 이벤트 수정 중 오류: 외부 이벤트에는 종료 시간이 필요합니다.');
                 } else if (error.message.includes('scheduled_start_time')) {
                     await interaction.editReply('❌ 이벤트 수정 중 오류: 시작 시간은 현재 시간 이후여야 합니다.');
                 } else {
                    await interaction.editReply('❌ 이벤트 수정 중 오류가 발생했습니다. 입력값을 확인해주세요.');
                 }
            } else if (error.code === 50013) { // Missing Permissions
                 await interaction.editReply('❌ 이벤트 수정 중 오류: 봇이 이벤트를 수정할 권한이 없습니다.');
            }
            else {
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

            // 이름으로 이벤트 찾기
            const events = await interaction.guild.scheduledEvents.fetch();
            const targetEvents = events.filter(event => event.name === eventName);

            if (targetEvents.size === 0) {
                return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트를 찾을 수 없습니다.`);
            }
            if (targetEvents.size > 1) {
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
            if (error.code === 50013) { // Missing Permissions
                 await interaction.editReply('❌ 이벤트 삭제 중 오류: 봇이 이벤트를 삭제할 권한이 없습니다.');
            } else if (error.code === 10062) { // Unknown Interaction or Event
                 await interaction.editReply('❌ 이벤트 삭제 중 오류: 해당 이벤트를 찾을 수 없거나 이미 삭제되었습니다.');
            }
            else {
                await interaction.editReply('❌ 이벤트를 삭제하는 중 오류가 발생했습니다.');
            }
        }
    }
    // --- 다른 슬래시 명령어 처리 ---
    else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("도움말")
            .setColor(0xFFD700)
            // 명령어 설명 업데이트
            .setDescription('명령어: /chat [질문] [file:첨부파일], /help, /avatar, /server, /call, /create_event [옵션들], /edit_event [옵션들], /delete_event [이름]');
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    else if (commandName === 'avatar') { await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true }); }
    else if (commandName === 'server') { await interaction.reply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`); }
    else if (commandName === 'call') { await interaction.reply(`<@${interaction.user.id}> !callback`); }
});

// --- 기존 메시지 기반 명령어 처리 (주석 처리 또는 제거) ---
/*
client.on('messageCreate', async msg => {
    // ...
});
*/
// ```

// **중요 알림:** 이 코드가 제대로 작동하려면 **Flowise의 `Tool Agent` 시스템 메시지**에서 `{{vars.bot_name}}` 형식으로 봇 이름을 참조하도록 **반드시 수정**해야 합니다.

// 예시 Flowise 시스템 메시지 수정:

// ```text
// 당신은 {{vars.bot_name}}이라는 이름을 가진 도움이 되는 AI 어시스턴트입니다. 사용자와 대화할 때 자신을 {{vars.bot_name}}(으)로 지칭하세요...
// ```

// 이제 이 코드를 사용하고 Flowise 시스템 메시지까지 수정하면, 봇이 Discord에서 설정된 자신의 이름을 인지하고 답변에 활용할 수 있게 됩