function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeUserText(value: string, privateValues: string[]): string {
  let text = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[비공개]")
    .replace(/\b\d{3}-\d{2}-\d{5}\b/g, "[비공개]")
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, "[비공개]")
    .replace(/(?:\+?82[-\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[비공개]");

  // shortcut: catches common Korean road/jibun addresses, upgrade to reviewed local NER for broader address detection.
  text = text.replace(/(?:서울(?:특별시)?|부산(?:광역시)?|대구(?:광역시)?|인천(?:광역시)?|광주(?:광역시)?|대전(?:광역시)?|울산(?:광역시)?|세종(?:특별자치시)?|제주(?:특별자치도)?|경기도|강원(?:특별자치)?도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도)\s+(?:[가-힣0-9-]+(?:시|군|구)\s+){1,2}[가-힣0-9-]+(?:로|길|동|가)\s+\d+(?:-\d+)?/g, "[비공개]");
  // shortcut: catches labeled or profile-known names and trade names, upgrade to reviewed local NER for unlabeled text.
  text = text.replace(/(^|[\s,;])((?:이름|성명|대표자|담당자|상호명|상호|가게명|매장명|업체명|사업장명|주민등록번호|사업자등록번호|사업자번호|계좌번호|사업장주소|매장주소|주소지|도로명주소|주소|연락처|휴대전화번호|휴대전화|휴대폰|전화번호|이메일|메일))(?=은|는|이|가|\s|:)(?:은|는|이|가)?\s*(?::\s*)?[^,;.!?\n]+/gi, "$1[비공개]");

  for (const privateValue of privateValues) {
    const trimmed = privateValue.trim();
    if (trimmed.length >= 2) text = text.replace(new RegExp(escapeRegExp(trimmed), "gi"), "[비공개]");
  }
  return text;
}
