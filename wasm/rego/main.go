// Exposes OPA's Rego compiler and evaluator as js/wasm callable from JavaScript,
// so the browser can compile and evaluate arbitrary Rego source live.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"
	"time"

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

// Builtins that reach outside the evaluation, removed from what policies may call.
//
// This bridge compiles whatever Rego the page hands it, so every builtin OPA ships is
// otherwise reachable from pasted source. http.send both makes real cross-origin
// requests from the visitor's browser and deadlocks the single goroutine this program
// runs on, which kills the runtime for the rest of the session. None of them are
// needed to evaluate an authorization policy.
var deniedBuiltinPrefixes = []string{"http.", "net.", "opa.runtime"}

func restrictedCapabilities() *ast.Capabilities {
	caps := ast.CapabilitiesForThisVersion()
	kept := make([]*ast.Builtin, 0, len(caps.Builtins))
	for _, b := range caps.Builtins {
		denied := false
		for _, prefix := range deniedBuiltinPrefixes {
			if strings.HasPrefix(b.Name, prefix) {
				denied = true
				break
			}
		}
		if !denied {
			kept = append(kept, b)
		}
	}
	caps.Builtins = kept
	return caps
}

func fail(msg string) any {
	b, _ := json.Marshal(evalResult{OK: false, Error: msg})
	return string(b)
}

// regoEval(policySrc, query, inputJSON, dataJSON, withTrace) -> JSON string
func regoEval(_ js.Value, args []js.Value) (result any) {
	// A panic anywhere in the compiler or evaluator would otherwise take down the whole
	// runtime, and the page has no way to tell that it did.
	defer func() {
		if r := recover(); r != nil {
			result = fail(fmt.Sprintf("evaluation panicked: %v", r))
		}
	}()

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
		rego.Capabilities(restrictedCapabilities()),
		rego.Module("policy.rego", policySrc),
		rego.Input(input),
	}

	// The data document, referenced from Rego as data.*
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

	// Nothing here should take measurable time; the deadline exists so that a pathological
	// comprehension cannot hang the one goroutine this program has.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rs, err := rego.New(opts...).Eval(ctx)
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
