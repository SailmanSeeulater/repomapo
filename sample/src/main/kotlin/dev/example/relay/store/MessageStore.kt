package dev.example.relay.store

import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Repository
import java.util.UUID

data class Envelope(
    val recipient: String,
    val ciphertext: String,
)

@Repository
class MessageRepository(
    private val redis: StringRedisTemplate,
) {

    fun save(env: Envelope): String {
        val id = UUID.randomUUID().toString()
        redis.opsForList()
            .rightPush(key(env.recipient), env.ciphertext)
        return id
    }

    fun findByRecipient(userId: String): List<Envelope> =
        redis.opsForList()
            .range(key(userId), 0, -1)
            .orEmpty()
            .map { Envelope(userId, it) }

    private fun key(userId: String) = "inbox:$userId"
}
