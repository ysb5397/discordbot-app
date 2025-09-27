const mongoose = require('mongoose');

const interactionSchema = new mongoose.Schema({
    interactionId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    type: {
        type: String,
        enum: ['MESSAGE', 'MENTION', 'VOICE', 'ERROR'],
        required: true
    },
    content: { type: String, required: true },
    botResponse: { type: String },
    timestamp: { type: Date, default: Date.now }
});

const Interaction = mongoose.model('Interaction', interactionSchema);

const connectDB = async () => {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
        console.error('오류: MONGO_URI 환경 변수가 설정되지 않았습니다. .env 설정을 확인해주세요.');
        return; 
    }

    try {
        await mongoose.connect(mongoURI);
        console.log('성공적으로 MongoDB에 연결되었어! ✅');
    } catch (err) {
        console.error('MongoDB 연결에 실패했어... 😭', err);
        throw err;
    }
};

const disconnectDB = async () => {
    try {
        await mongoose.disconnect();
        console.log('MongoDB 연결이 성공적으로 종료되었어. 🛑');
    } catch (err) {
        console.error('MongoDB 연결 종료 중 오류 발생:', err);
        throw err;
    }
};

const reconnectDB = async () => {
    console.log('MongoDB 재연결을 시도합니다...');
    await disconnectDB();
    await connectDB();
};

module.exports = {
    Interaction,
    connectDB,
    disconnectDB,
    reconnectDB,
};
