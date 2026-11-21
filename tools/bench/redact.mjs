// 결과에 저장되는 문자열에서 알려진 API 키와 자격 증명 할당을 가린다.
const SECRET_NAME = /^(?:[\w-]+[_-])?(?:api[_-]?key|token|secret|password)$/i;

export function redactAgentCommand(command) {
  return String(command)
    .replace(/\b((?:[\w-]+[_-])?(?:api[_-]?key|token|secret|password))=(?:"[^"]*"|'[^']*'|[^\s;]+)/gi, "$1=***")
    .replace(/(--(?:[\w-]+[_-])?(?:api[_-]?key|token|secret|password))\s+(?:"[^"]*"|'[^']*'|[^\s;]+)/gi, "$1 ***")
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, "sk-***");
}

export function redactAgentArgv(argv) {
  return argv.map((arg, index) => {
    const previous = argv[index - 1];
    if (previous?.startsWith("--") && SECRET_NAME.test(previous.slice(2))) return "***";
    const [name] = arg.split("=", 1);
    if (name !== arg && SECRET_NAME.test(name.replace(/^--/, ""))) return `${name}=***`;
    return redactAgentCommand(arg);
  }).join(" ");
}

export function redactAgentPayload(payload) {
  try {
    return JSON.parse(JSON.stringify(payload, (key, value) => {
      if (SECRET_NAME.test(key)) return "***";
      if (typeof value === "string") return redactAgentCommand(value);
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const fields = Object.entries(value);
      if (!fields.some(([name]) => redactAgentCommand(name) !== name)) return value;
      return Object.fromEntries(fields.map(([name, field]) => [redactAgentCommand(name), field]));
    }));
  } catch {
    return null;
  }
}
