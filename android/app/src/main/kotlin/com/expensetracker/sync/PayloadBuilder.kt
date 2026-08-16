package com.expensetracker.sync

import com.expensetracker.data.RawNotificationEntity
import com.expensetracker.sanitize.RedactionResult
import com.expensetracker.sanitize.Redactor
import com.expensetracker.sanitize.RedactionType
import org.json.JSONArray
import org.json.JSONObject

/**
 * Turns a Room row into the sanitized PostgREST payload (agents.md §6
 * step 3 / §8). The redaction pass runs *here*, at sync time, on the
 * untouched Room copy — never on the binder thread — so a capture that
 * happened while a redaction bug was live can still be re-uploaded
 * correctly once the fix lands.
 */
object PayloadBuilder {

    fun redactEntity(entity: RawNotificationEntity): RedactedEntity {
        val title = entity.title?.let { Redactor.redact(it) }
        val textBody = entity.textBody?.let { Redactor.redact(it) }
        val bigText = entity.bigText?.let { Redactor.redact(it) }
        val subText = entity.subText?.let { Redactor.redact(it) }
        val applied = setOfNotNull(
            title?.applied,
            textBody?.applied,
            bigText?.applied,
            subText?.applied,
        ).flatten().toSet()
        return RedactedEntity(entity, title, textBody, bigText, subText, applied)
    }

    fun toPayload(entity: RawNotificationEntity): JSONObject {
        val r = redactEntity(entity)
        val applied = JSONArray()
        RedactionType.entries
            .filter { it in r.applied }
            .forEach { applied.put(it.name.lowercase()) }

        return JSONObject()
            .put("client_uuid", r.entity.clientUuid)
            .put("device_id", r.entity.deviceId)
            .put("package_name", r.entity.packageName)
            .put("app_label", r.entity.appLabel ?: JSONObject.NULL)
            .put("notification_key", r.entity.notificationKey ?: JSONObject.NULL)
            .put("title", r.title?.redacted ?: JSONObject.NULL)
            .put("text_body", r.textBody?.redacted ?: JSONObject.NULL)
            .put("big_text", r.bigText?.redacted ?: JSONObject.NULL)
            .put("sub_text", r.subText?.redacted ?: JSONObject.NULL)
            .put("is_group_summary", r.entity.isGroupSummary)
            .put("posted_at", SupabaseApi.iso8601(r.entity.postedAt))
            .put("content_hash", r.entity.contentHash)
            .put("redactions_applied", applied)
    }

    data class RedactedEntity(
        val entity: RawNotificationEntity,
        val title: RedactionResult?,
        val textBody: RedactionResult?,
        val bigText: RedactionResult?,
        val subText: RedactionResult?,
        val applied: Set<RedactionType>,
    )
}
