package logger

import (
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
)

// AppLogger handles global log capture and DB persistence
type AppLogger struct {
	db       *data_centralizegg.DB
	logChan  chan data_centralizegg.AppLog
	stopChan chan struct{}
}

var (
	// Regex to extract module from logs like "[PodmanCollector] Starting..."
	moduleRegex = regexp.MustCompile(`^\[([^\]]+)\]`)
)

func NewAppLogger(db *data_centralizegg.DB) *AppLogger {
	l := &AppLogger{
		db:       db,
		logChan:  make(chan data_centralizegg.AppLog, 1000),
		stopChan: make(chan struct{}),
	}
	go l.processLogs()
	return l
}

func (l *AppLogger) Write(p []byte) (n int, err error) {
	msg := string(p)

	// Clean typical log prefixes if present (standard log package usually adds date/time)
	// For simplicity, we assume the message is the raw content since we'll use it as io.Writer

	level := "INFO"
	if strings.Contains(strings.ToUpper(msg), "ERROR") || strings.Contains(strings.ToUpper(msg), "FAILED") {
		level = "ERROR"
	} else if strings.Contains(strings.ToUpper(msg), "WARN") {
		level = "WARNING"
	} else if strings.Contains(strings.ToUpper(msg), "DEBUG") {
		level = "DEBUG"
	}

	module := "System"
	matches := moduleRegex.FindStringSubmatch(strings.TrimSpace(msg))
	if len(matches) > 1 {
		module = matches[1]
		// Optional: strip module from message to avoid redundancy
		// msg = strings.TrimSpace(msg[len(matches[0]):])
	}

	l.logChan <- data_centralizegg.AppLog{
		Timestamp: time.Now(),
		Level:     level,
		Module:    module,
		Message:   strings.TrimSpace(msg),
	}

	return len(p), nil
}

func (l *AppLogger) processLogs() {
	for {
		select {
		case logEntry := <-l.logChan:
			if l.db != nil {
				_ = l.db.LogAppMessage(logEntry.Level, logEntry.Module, logEntry.Message)
			}
		case <-l.stopChan:
			return
		}
	}
}

func (l *AppLogger) Close() {
	close(l.stopChan)
}

// Global log interceptor setup
func SetupGlobalLogger(db *data_centralizegg.DB) io.Writer {
	appLogger := NewAppLogger(db)
	return appLogger
}
