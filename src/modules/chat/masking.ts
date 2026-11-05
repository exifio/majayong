/**
 * B-03/B-02 공용: 계약 체결 전 연락처 가림.
 *
 * 전화·이메일·메신저 ID를 저장 전에 가리고, 가린 본문만 저장한다.
 * 원문은 어디에도 남기지 않는다(ERD 9 [채팅 가림]).
 */

export const CONTACT_PLACEHOLDER = '[연락처 비공개]';

export interface MaskResult {
  readonly text: string;
  readonly masked: boolean;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?82[-\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const MESSENGER_WITH_ID =
  /(?:카카오톡|카톡|텔레그램|텔레그렘|라인|왓츠앱|whatsapp|telegram|kakao(?:talk)?|line)\s*(?:id|아이디)?\s*[:=]?\s*[A-Za-z0-9._-]{3,}/gi;
const HANDLE = /(?<![A-Za-z0-9._%+-])@[A-Za-z0-9._]{3,}/g;

/** 순서가 중요하다: 이메일 → 전화 → 키워드가 붙은 메신저 ID → @handle. */
export function maskContacts(text: string): MaskResult {
  let masked = text;
  for (const pattern of [EMAIL, PHONE, MESSENGER_WITH_ID, HANDLE]) {
    masked = masked.replace(pattern, CONTACT_PLACEHOLDER);
  }
  return { text: masked, masked: masked !== text };
}
