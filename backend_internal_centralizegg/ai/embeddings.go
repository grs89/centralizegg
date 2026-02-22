package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Constantes de Gemini
const (
	GeminiBaseURL     = "https://generativelanguage.googleapis.com/v1beta/models"
	EmbeddingModel    = "text-embedding-004" // Modelo optimizado para RAG y vectores de 768 dims
	EmbeddingEndpoint = "embedContent"
)

// Petición a la API de embeddings de Google Gemini
type EmbeddingRequest struct {
	Model   string         `json:"model"`
	Content ContentPayload `json:"content"`
}

type ContentPayload struct {
	Parts []PartPayload `json:"parts"`
}

type PartPayload struct {
	Text string `json:"text"`
}

// Respuesta de la API de embeddings
type EmbeddingResponse struct {
	Embedding struct {
		Values []float32 `json:"values"`
	} `json:"embedding"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// GenerateEmbedding llama a la API de Gemini para convertir un texto en un vector matemático (768 dimensiones).
func GenerateEmbedding(text string, apiKey string) ([]float32, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("gemini api key is missing")
	}

	url := fmt.Sprintf("%s/%s:%s?key=%s", GeminiBaseURL, EmbeddingModel, EmbeddingEndpoint, apiKey)

	reqBody := EmbeddingRequest{
		Model: fmt.Sprintf("models/%s", EmbeddingModel),
		Content: ContentPayload{
			Parts: []PartPayload{
				{Text: text},
			},
		},
	}

	jsonValue, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal embedding request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonValue))
	if err != nil {
		return nil, fmt.Errorf("failed to create http request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute http request: %w", err)
	}
	defer res.Body.Close()

	bodyBytes, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if res.StatusCode != 200 {
		return nil, fmt.Errorf("api returned status %d: %s", res.StatusCode, string(bodyBytes))
	}

	var embedRes EmbeddingResponse
	if err := json.Unmarshal(bodyBytes, &embedRes); err != nil {
		return nil, fmt.Errorf("failed to unmarshal embedding response: %w", err)
	}

	if embedRes.Error != nil {
		return nil, fmt.Errorf("api error: %s", embedRes.Error.Message)
	}

	if len(embedRes.Embedding.Values) == 0 {
		return nil, fmt.Errorf("received empty embeddings array from API")
	}

	return embedRes.Embedding.Values, nil
}
