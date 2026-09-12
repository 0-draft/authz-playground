// OPA の Rego コンパイラ+評価器を js/wasm に載せ、JS から呼べる形で公開する。
// ブラウザ側で任意の Rego ソースをライブ評価するための橋渡し。
package main

import (
	"context"
	"encoding/json"
	"strings"
	"syscall/js"

	"github.com/open-policy-agent/opa/v1/ast"
	"github.com/open-policy-agent/opa/v1/rego"
	"github.com/open-policy-agent/opa/v1/storage/inmem"
	"github.com/open-policy-agent/opa/v1/topdown"
)

type evalResult struct {
	OK      bool     `json:"ok"`
	Defined bool     `json:"defined"`
	Value   any      `json:"value,omitempty"`
	Error   string   `json:"error,omitempty"`
	Trace   []string `json:"trace,omitempty"`
}

func fail(msg string) any {
	b, _ := json.Marshal(evalResult{OK: false, Error: msg})
	return string(b)
}

// regoEval(policySrc, query, inputJSON, dataJSON, withTrace) -> JSON string
func regoEval(_ js.Value, args []js.Value) any {
	if len(args) < 3 {
		return fail("regoEval(policy, query, inputJSON, dataJSON?, withTrace?) requires 3 args")
	}
	policySrc := args[0].String()
	query := args[1].String()
	inputJSON := args[2].String()
	dataJSON := ""
	if len(args) > 3 && args[3].Type() == js.TypeString {
		dataJSON = args[3].String()
	}
	withTrace := len(args) > 4 && args[4].Truthy()

	var input any
	if strings.TrimSpace(inputJSON) != "" {
		if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
			return fail("input is not valid JSON: " + err.Error())
		}
	}

	opts := []func(*rego.Rego){
		rego.Query(query),
		rego.SetRegoVersion(ast.RegoV1),
		rego.Module("policy.rego", policySrc),
		rego.Input(input),
	}

	// data ドキュメント (Rego から data.* で参照される)
	if strings.TrimSpace(dataJSON) != "" {
		var data map[string]any
		if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
			return fail("data is not valid JSON object: " + err.Error())
		}
		opts = append(opts, rego.Store(inmem.NewFromObject(data)))
	}

	var tracer *topdown.BufferTracer
	if withTrace {
		tracer = topdown.NewBufferTracer()
		opts = append(opts, rego.QueryTracer(tracer))
	}

	rs, err := rego.New(opts...).Eval(context.Background())
	if err != nil {
		return fail(err.Error())
	}

	out := evalResult{OK: true}
	if len(rs) > 0 && len(rs[0].Expressions) > 0 {
		out.Defined = true
		out.Value = rs[0].Expressions[0].Value
	}
	if tracer != nil {
		var sb strings.Builder
		topdown.PrettyTrace(&sb, *tracer)
		for _, line := range strings.Split(strings.TrimRight(sb.String(), "\n"), "\n") {
			if line != "" {
				out.Trace = append(out.Trace, line)
			}
		}
	}

	b, err := json.Marshal(out)
	if err != nil {
		return fail("failed to encode result: " + err.Error())
	}
	return string(b)
}

func main() {
	js.Global().Set("regoEval", js.FuncOf(regoEval))
	js.Global().Set("regoReady", js.ValueOf(true))
	select {} // JS から呼ばれ続けるので終了させない
}
