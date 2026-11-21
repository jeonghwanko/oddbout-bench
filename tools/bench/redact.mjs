// 요약의 `agent` 칸에 명령 문자열이 남는다. 흔한 API 키 모양만 가린다(완벽한 비밀 제거는 아니다).
export function redactAgentCommand(command) {
  return String(command)
    .replace(/\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)=([^\s]+)/gi, "$1=***")
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***")
    .replace(/\bsk-[A-Za-z0-9]{20,}/g, "sk-***");
}
