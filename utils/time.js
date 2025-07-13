// utils/time.js

// KST 문자열을 UTC Date 객체로 파싱하는 함수
function parseKSTDateTime(dateTimeString) {
    const dateParts = dateTimeString.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})$/);
    if (!dateParts) throw new Error("Invalid date format. Use 'YYYY-MM-DD HH:MM'");
    
    const year = parseInt(dateParts[1]);
    const month = parseInt(dateParts[2]) - 1;
    const day = parseInt(dateParts[3]);
    const hourKST = parseInt(dateParts[4]);
    const minute = parseInt(dateParts[5]);

    // KST(UTC+9)이므로 UTC로 변환하려면 9시간을 빼줍니다.
    const utcTimestamp = Date.UTC(year, month, day, hourKST - 9, minute);
    const dateObject = new Date(utcTimestamp);
    
    if (isNaN(dateObject.getTime())) throw new Error('Invalid date calculation');
    return dateObject;
}

module.exports = { parseKSTDateTime };