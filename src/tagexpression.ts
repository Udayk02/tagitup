export type TagExpression = (tags: string[]) => boolean;

// checks whether tags exists
const tagExpr = (tagName: string): TagExpression => (tags) =>
    tags.includes(tagName);
// checks whether both expressions are true
const andExpr = (left: TagExpression, right: TagExpression): TagExpression => (tags) =>
    left(tags) && right(tags);
// checks whether either of the expressions are true
const orExpr = (left: TagExpression, right: TagExpression): TagExpression => (tags) =>
    left(tags) || right(tags);

// tokens: '(', ')', '&', '|' or tag words.
function tokenize(input: string): string[] {
    // matches operators, parentheses, or any sequence of non-space and non-operator characters.
    const tokens = input.match(/\(|\)|\&|\||[^\s\&\|\(\)]+/g);
    return tokens ? tokens : [];
}

// recursive descent parser for tag expressions.
// this is a direct reference to the traditional descent parsers
// just customized to work in this scenario
export function parseTagQuery(query: string): TagExpression {
    const tokens = tokenize(query);
    let index = 0;

    function peek(): string | null {
        return tokens[index] || null;
    }

    function consume(): string {
        return tokens[index++];
    }

    function parsePrimary(): TagExpression {
        const token = peek();
        if (token === null) {
            throw new Error("Unexpected end of input");
        }
        if (token === "(") {
            consume(); // consume '('
            const expr = parseOr();
            if (peek() !== ")") {
                throw new Error("Expected ')'");
            }
            consume(); // consume ')'
            return expr;
        }
        // otherwise, assume it's a tag literal.
        consume();
        // trim possible extra characters and return a tag expression.
        return tagExpr(token);
    }

    // Parse AND expressions.
    function parseAnd(): TagExpression {
        let expr = parsePrimary();
        while (peek() === "&") {
            consume(); // consume '&'
            const right = parsePrimary();
            expr = andExpr(expr, right);
        }
        return expr;
    }

    // Parse OR expressions.
    function parseOr(): TagExpression {
        let expr = parseAnd();
        while (peek() === "|") {
            consume(); // consume '|'
            const right = parseAnd();
            expr = orExpr(expr, right);
        }
        return expr;
    }

    const result = parseOr();
    if (index < tokens.length) {
        throw new Error("Unexpected token: " + peek());
    }
    return result;
}