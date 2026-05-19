const CHINA_TIME_ZONE = 'Asia/Shanghai';

function normalizeDateInput(value: string | number | Date) {
  if (typeof value !== 'string') return value;
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(value)) return value;
  return value.includes('T') ? `${value}Z` : `${value.replace(' ', 'T')}Z`;
}

export function toChinaDate(value: string | number | Date) {
  return new Date(normalizeDateInput(value));
}

export function formatChinaDateTime(value: string | number | Date) {
  return toChinaDate(value).toLocaleString('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function formatChinaMonthDayTime(value: string | number | Date) {
  return toChinaDate(value).toLocaleString('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatChinaTime(value: string | number | Date) {
  return toChinaDate(value).toLocaleTimeString('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function chinaTimestamp(value: string | number | Date) {
  return toChinaDate(value).getTime();
}
