const FUNCTIONS = Object.freeze({ trunc: Math.trunc, floor: Math.floor, ceil: Math.ceil, round: Math.round });

export function integer(value) {
  if (typeof value !== "number") return value;
  if (!Number.isFinite(value)) throw new Error("O cálculo deve retornar um número finito (verifique divisões por zero)");
  const result = Math.trunc(value);
  if (!Number.isSafeInteger(result)) throw new Error("O cálculo excedeu o limite de inteiros seguros");
  return result === 0 ? 0 : result;
}

// Gramática restrita: números, referências, + - * / %, parênteses e arredondamento.
// Não executa JavaScript nem permite acessar propriedades, métodos ou código externo.
export function evaluateExpression(source, resolve, { preserveDecimals = false } = {}) {
  const tokens = [];
  const pattern = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{N}_]*|[+*/%(),-]/uy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Caractere inválido na expressão: ${source.slice(offset)}`);
    offset = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
  }
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  function expect(token) {
    if (take() !== token) throw new Error(`Esperado "${token}" na expressão: ${source}`);
  }
  function number(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Cálculo exige números finitos: ${source}`);
    return value;
  }
  function primary() {
    const token = take();
    if (token === "(") {
      const value = sum();
      expect(")");
      return value;
    }
    if (token && /^(?:\d|\.)/.test(token)) return number(Number(token));
    if (token && /^[\p{L}_]/u.test(token)) {
      if (peek() !== "(") return resolve(token);
      if (!Object.hasOwn(FUNCTIONS, token)) throw new Error(`Função não permitida: ${token}`);
      take();
      const argument = number(sum());
      expect(")");
      return number(FUNCTIONS[token](argument));
    }
    throw new Error(`Expressão inválida: ${source}`);
  }
  function unary() {
    if (peek() === "+") { take(); return number(unary()); }
    if (peek() === "-") { take(); return -number(unary()); }
    return primary();
  }
  function product() {
    let value = unary();
    while (["*", "/", "%"].includes(peek())) {
      const operator = take(), left = number(value), right = number(unary());
      value = number(operator === "*" ? left * right : operator === "/" ? left / right : left % right);
    }
    return value;
  }
  function sum() {
    let value = product();
    while (["+", "-"].includes(peek())) {
      const operator = take(), left = number(value), right = number(product());
      value = number(operator === "+" ? left + right : left - right);
    }
    return value;
  }
  const result = sum();
  if (position !== tokens.length) throw new Error(`Trecho inesperado na expressão: ${tokens.slice(position).join(" ")}`);
  return preserveDecimals ? result : integer(result);
}
