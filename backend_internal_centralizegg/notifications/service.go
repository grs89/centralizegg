package notifications

import (
	"bytes"
	json "github.com/goccy/go-json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

type NotificationSettings struct {
	Enabled    bool               `json:"enabled"`
	Telegram   TelegramSettings   `json:"telegram"`
	Slack      SlackSettings      `json:"slack"`
	Discord    DiscordSettings    `json:"discord"`
	GoogleChat GoogleChatSettings `json:"google_chat"`
	Teams      TeamsSettings      `json:"teams"`
	Thresholds ThresholdSettings  `json:"thresholds"`
}

type TelegramSettings struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
	ChatID  string `json:"chatId"`
}

type SlackSettings struct {
	Enabled    bool   `json:"enabled"`
	WebhookURL string `json:"webhookUrl"`
}

type DiscordSettings struct {
	Enabled    bool   `json:"enabled"`
	WebhookURL string `json:"webhookUrl"`
}

type GoogleChatSettings struct {
	Enabled    bool   `json:"enabled"`
	WebhookURL string `json:"webhookUrl"`
}

type TeamsSettings struct {
	Enabled    bool   `json:"enabled"`
	WebhookURL string `json:"webhookUrl"`
}

type ThresholdSettings struct {
	CPUCritical float64 `json:"cpu_critical"`
	RAMCritical float64 `json:"ram_critical"`
}

var (
	suppressor      = make(map[string]time.Time)
	suppressorMutex sync.Mutex
	suppressTTL     = 30 * time.Minute
)

func Notify(settingsJSON string, level string, message string, contextKey string) {
	if settingsJSON == "" || settingsJSON == "{}" {
		return
	}

	var settings NotificationSettings
	if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
		log.Printf("[Notifications] Error unmarshaling settings: %v", err)
		return
	}

	if !settings.Enabled {
		return
	}

	// Suppression logic
	if contextKey != "" {
		suppressorMutex.Lock()
		lastTime, found := suppressor[contextKey]
		if found && time.Since(lastTime) < suppressTTL {
			suppressorMutex.Unlock()
			return
		}
		suppressor[contextKey] = time.Now()
		suppressorMutex.Unlock()
	}

	formattedMsg := fmt.Sprintf("[%s] %s", level, message)

	if settings.Telegram.Enabled && settings.Telegram.Token != "" && settings.Telegram.ChatID != "" {
		go sendTelegram(settings.Telegram, formattedMsg)
	}

	if settings.Slack.Enabled && settings.Slack.WebhookURL != "" {
		go sendSlack(settings.Slack, formattedMsg)
	}

	if settings.Discord.Enabled && settings.Discord.WebhookURL != "" {
		go sendDiscord(settings.Discord, formattedMsg)
	}

	if settings.GoogleChat.Enabled && settings.GoogleChat.WebhookURL != "" {
		go sendGoogleChat(settings.GoogleChat, formattedMsg)
	}

	if settings.Teams.Enabled && settings.Teams.WebhookURL != "" {
		go sendTeams(settings.Teams, formattedMsg)
	}
}

func sendTelegram(s TelegramSettings, msg string) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", s.Token)
	payload := map[string]string{
		"chat_id":    s.ChatID,
		"text":       msg,
		"parse_mode": "Markdown",
	}
	body, _ := json.Marshal(payload)
	resp, err := http.Post(url, "application/json", bytes.NewBuffer(body))
	if err != nil {
		log.Printf("[Notifications] Telegram error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func sendSlack(s SlackSettings, msg string) {
	payload := map[string]string{"text": msg}
	body, _ := json.Marshal(payload)
	resp, err := http.Post(s.WebhookURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		log.Printf("[Notifications] Slack error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func sendDiscord(s DiscordSettings, msg string) {
	payload := map[string]string{"content": msg}
	body, _ := json.Marshal(payload)
	resp, err := http.Post(s.WebhookURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		log.Printf("[Notifications] Discord error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func sendGoogleChat(s GoogleChatSettings, msg string) {
	payload := map[string]string{"text": msg}
	body, _ := json.Marshal(payload)
	resp, err := http.Post(s.WebhookURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		log.Printf("[Notifications] Google Chat error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func sendTeams(s TeamsSettings, msg string) {
	payload := map[string]string{"text": msg}
	body, _ := json.Marshal(payload)
	resp, err := http.Post(s.WebhookURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		log.Printf("[Notifications] Teams error: %v", err)
		return
	}
	defer resp.Body.Close()
}
