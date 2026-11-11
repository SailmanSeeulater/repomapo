package dev.example.relay.api

import dev.example.relay.service.MessageService
import dev.example.relay.store.Envelope
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/v1/messages")
class MessageController(
    private val service: MessageService,
) {

    @PostMapping
    fun send(@RequestBody env: Envelope): Receipt {
        val id = service.relay(env)
        return Receipt(id)
    }

    @GetMapping("/{userId}")
    fun inbox(@PathVariable userId: String): List<Envelope> =
        service.pending(userId)
}

data class Receipt(val id: String)
