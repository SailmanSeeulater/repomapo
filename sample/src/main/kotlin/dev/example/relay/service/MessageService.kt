package dev.example.relay.service

import dev.example.relay.store.Envelope
import dev.example.relay.store.MessageRepository
import org.springframework.stereotype.Service

@Service
class MessageService(
    private val repo: MessageRepository,
) {

    fun relay(env: Envelope): String {
        validate(env)
        return repo.save(env)
    }

    fun pending(userId: String): List<Envelope> =
        repo.findByRecipient(userId)

    private fun validate(env: Envelope) {
        require(env.ciphertext.isNotEmpty())
        require(env.recipient.isNotBlank())
    }
}
