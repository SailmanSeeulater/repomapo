// Small Kotlin + Spring project used as the indexing target for the thread view.
// It only has to compile; nothing here runs.
plugins {
    kotlin("jvm") version "2.2.0"
}

group = "dev.example"
version = "0.0.1"

repositories {
    mavenCentral()
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.5.3"))
    implementation("org.springframework:spring-web")
    implementation("org.springframework:spring-context")
    implementation("org.springframework.data:spring-data-redis")
}

kotlin {
    jvmToolchain(21)
}
