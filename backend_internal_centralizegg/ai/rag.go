package ai

import (
	"database/sql"
	json "github.com/goccy/go-json"
	"fmt"

	"github.com/pgvector/pgvector-go"
)

// EventMemory representa un ticket en la memoria del asistente (RAG)
type EventMemory struct {
	ID        int64
	Timestamp string
	EventType string
	Content   string
	Metadata  map[string]interface{}
}

// SaveEventToMemory genera el embedding del contenido y lo inserta en config.event_memory
func SaveEventToMemory(db *sql.DB, apiKey, eventType, content string, metadata map[string]interface{}) error {
	// 1. Generar Vector usando Gemini
	embedding, err := GenerateEmbedding(content, apiKey)
	if err != nil {
		return fmt.Errorf("error generating embedding: %w", err)
	}

	// 2. Serializar metadata a JSONB
	metaJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("error marshaling metadata: %w", err)
	}

	// Convertir slice normal a vector de pgvector
	vec := pgvector.NewVector(embedding)

	// 3. Insertar a PostgreSQL
	query := `
		INSERT INTO config.event_memory (event_type, content, metadata, embedding)
		VALUES ($1, $2, $3, $4)
	`
	_, err = db.Exec(query, eventType, content, string(metaJSON), vec)
	if err != nil {
		return fmt.Errorf("error inserting to event_memory: %w", err)
	}

	return nil
}

// SearchSimilarEvents vectoriza el prompt del usuario y busca en la base de datos usando <=> (Coseno)
func SearchSimilarEvents(db *sql.DB, apiKey, queryStr string, limit int) ([]EventMemory, error) {
	// 1. Convertir la pregunta en un vector
	queryEmbedding, err := GenerateEmbedding(queryStr, apiKey)
	if err != nil {
		return nil, fmt.Errorf("error embedding query string: %w", err)
	}

	vec := pgvector.NewVector(queryEmbedding)

	// 2. Consulta de similitud usando el índice HNSW (Distancia de Coseno <=>)
	// Traemos solo los eventos relevantes. Ajustamos limit, por lo general con top 3 a 5 basta para LLM Context
	query := `
		SELECT id, timestamp, event_type, content, metadata
		FROM config.event_memory
		ORDER BY embedding <=> $1
		LIMIT $2
	`

	rows, err := db.Query(query, vec, limit)
	if err != nil {
		return nil, fmt.Errorf("error executing vector search query: %w", err)
	}
	defer rows.Close()

	var events []EventMemory
	for rows.Next() {
		var em EventMemory
		var metaStr string

		if err := rows.Scan(&em.ID, &em.Timestamp, &em.EventType, &em.Content, &metaStr); err != nil {
			return nil, fmt.Errorf("error scanning row: %w", err)
		}

		if metaStr != "" {
			if err := json.Unmarshal([]byte(metaStr), &em.Metadata); err != nil {
				return nil, fmt.Errorf("error unmarshaling metadata: %w", err)
			}
		}

		events = append(events, em)
	}

	return events, nil
}
