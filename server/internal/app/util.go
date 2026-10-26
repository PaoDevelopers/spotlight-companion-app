package app

import "encoding/json"

func jsonText(v any) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}
