-- B-06: 알림 멱등 키. 같은 (userId, type, targetId)는 1행만 허용한다.
-- 적용 전 기존 중복을 최신 1건으로 정리한다(동률이면 id 큰 쪽 유지).
DELETE FROM "notifications" n
USING "notifications" d
WHERE n."userId" = d."userId"
  AND n."type" = d."type"
  AND n."targetId" = d."targetId"
  AND (n."createdAt", n."id") < (d."createdAt", d."id");

CREATE UNIQUE INDEX "notifications_user_type_target_key"
  ON "notifications"("userId", "type", "targetId");
