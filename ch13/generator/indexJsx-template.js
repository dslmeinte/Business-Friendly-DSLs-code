const { isAstObject, isAstReference } = require("../common/ast")
const { requiresParentheses } = require("../language/operators")
const { isComputedFromExpression, referencedAttributesInValue } = require("../language/queries")
const { dependencyOrderOf } = require("./dependency-utils")
const { asString, camelCase, indent, withFirstUpper } = require("./template-utils")


const jsOperatorFor = (operator) => {
    switch (operator) {
        case "of": return "* 0.01 *"
        case "^": return "**"
        default: return operator
    }
}

const jsNameFor = (attribute) => camelCase(attribute.settings["name"])

const expressionFor = (value, ancestors) => {
    if (!isAstObject(value)) {
        return `/* [GENERATION PROBLEM] value "${value}" isn't handled in expressionFor */`
    }
    const { settings } = value
    switch (value.concept) {
        case "Attribute Reference": {
            const targetAttribute = isAstReference(settings["attribute"]) && settings["attribute"].ref
            return targetAttribute ? `this.${jsNameFor(targetAttribute)}` : `/* [GENERATION PROBLEM] attribute reference is undefined */`
        }
        case "Binary Operation": {
            const { operator } = settings
            const nextAncestors = [ value, ...ancestors ]
            const withoutParentheses = `${expressionFor(settings["left operand"], nextAncestors)} ${jsOperatorFor(operator)} ${expressionFor(settings["right operand"], nextAncestors)}`
            return requiresParentheses(value, ancestors[0]) ? `(${withoutParentheses})` : withoutParentheses
        }
        case "Number": {
            const numberValue = settings["value"]
            return numberValue === undefined ? `/* [GENERATION PROBLEM] number's value is undefined */` : numberValue
        }
        case "Parentheses": return `(${expressionFor(settings["sub"], [ value, ...ancestors ])})`
        default: return `/* [GENERATION PROBLEM] value of concept "${value.concept}" isn't handled in expressionFor */`
    }
}
module.exports.expressionFor = expressionFor    // (make public to test this function separately)

const defaultInitExpressionForType = (type) => {
    switch (type) {
        case "amount": return `0.0`
        case "percentage": return `0`
        case "period in days": return `new Period()`
        default: return `/* [GENERATION PROBLEM] type "${type}" isn't handled in defaultInitExpressionForType */`
    }
}

const classField = (attribute) => {
    const { settings } = attribute
    const value = settings["value"]
    const fieldName = jsNameFor(attribute)
    if (isComputedFromExpression(attribute)) {
        return [
            `get ${fieldName}() {`,
            `    return ${expressionFor(value, [])}`,
            `}`
        ]
    }
    return `${fieldName} = ${
        isAstObject(value)
            ? expressionFor(value, [])
            : defaultInitExpressionForType(settings["type"])
    }`
}

const formFieldInput = (type, objectExpr, fieldName) => `<Input type="${type}" object={${objectExpr}} fieldName="${fieldName}" />`

const formFieldInputs = (objectExpr, attribute) => {
    const { settings } = attribute
    const { type } = settings
    const fieldName = jsNameFor(attribute)
    const isComputed = isComputedFromExpression(attribute)
    switch (type) {
        case "amount": return "$ " + (isComputed ? `{${objectExpr}.${fieldName}.toFixed(2)}` : formFieldInput("number", objectExpr, fieldName))
        case "percentage": return (isComputed ? `{${objectExpr}.${fieldName}}` : formFieldInput("number", objectExpr, fieldName)) + " %"
        case "period in days": return [ "from", "to" ].map((subFieldName) => formFieldInput("date", `${objectExpr}.${fieldName}`, subFieldName))
        default: return `// [GENERATION PROBLEM] type "${type}" isn't handled in formFieldInputs`
    }
}

const formField = (objectExpr, attribute) => [
    `<FormField label="${withFirstUpper(attribute.settings["name"])}">`,
    indent(1)(formFieldInputs(objectExpr, attribute)),
    `</FormField>`
]

const indexJsx = (recordType) => {
    const name = jsNameFor(recordType)
    const Name = withFirstUpper(name)
    const { attributes } = recordType.settings

    return [
        `import React from "react"
import { render } from "react-dom"
import { makeAutoObservable } from "mobx"
import { observer } from "mobx-react"

import { FormField, Input } from "./components"
import { Period } from "./dates"

require("./styling.css")

class ${Name} {`,
        indent(1)((dependencyOrderOf(attributes, referencedAttributesInValue) || attributes).map(classField)),
        `    constructor() {
        makeAutoObservable(this)
    }
}

const ${Name}Form = observer(({ ${name} }) => <form>`,
        indent(1)(attributes.map((attribute) => formField(name, attribute))),
        `</form>)

const ${name} = new ${Name}()

const App = observer(() => <div>
    <${Name}Form ${name}={${name}} />
</div>)

render(
    <App />,
    document.getElementById("root")
)
`
    ]
}

module.exports.generatedIndexJsx = (ast) => asString(indexJsx(ast))

