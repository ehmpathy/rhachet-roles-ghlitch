
  -- query_name = find_all_chat_message_transmission_by_message_and_role
  SELECT
    chat_message_transmission.id,
    chat_message_transmission.uuid,
    chat_message_transmission.created_at,
    (
      SELECT chat_message.uuid
      FROM chat_message WHERE chat_message.id = chat_message_transmission.message_id
    ) AS message_uuid,
    (
      SELECT chat_participant.uuid
      FROM chat_participant WHERE chat_participant.id = chat_message_transmission.participant_id
    ) AS participant_uuid,
    chat_message_transmission.role,
    chat_message_transmission.channel,
    chat_message_transmission.relay_external_id,
    chat_message_transmission.notification_external_id
  FROM chat_message_transmission
  WHERE 1=1
    AND chat_message_transmission.message_id = (SELECT id FROM chat_message WHERE chat_message.uuid = :messageUuid)
    AND chat_message_transmission.role = :role
  ORDER BY chat_message_transmission.created_at DESC
  LIMIT :limit
