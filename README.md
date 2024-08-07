# Tension: An RDF surfaces reasoner

[![npm version](https://badge.fury.io/js/rdf-tension.svg)](https://www.npmjs.com/package/rdf-tension)

An [RDF Surfaces](https://w3c-cg.github.io/rdfsurfaces/) reasoner.

Some random notes:

* Program can be run with `node bin/tension.js --help` to see the available CLI options.
* Run with `info` logging (default) to only see the deduced triples, run with `debug` to see what is going on internally.
* Probably not completely logically sound.
  Triples with the same blank node twice or some weird existential/universal combinations will probably trip it up.
* Not handling existentials that well yet.
* Tests can be found at <https://github.com/eyereasoner/rdfsurfaces-tests>.

## Using as npm dependency

`npm install rdf-tension`

```ts
import { readFileSync } from 'node:fs';
import { run } from 'rdf-tension';

const input = readFileSync('my/surfaces/file.n3s').toString();

// All options besides `input` are optional.
// The values below are the defaults.
const options = {
  input,
  // Set this to 0 for infinite steps
  maxSteps: 5,
  ignoreAnswer: false,
  logLevle: 'error',
};

// Note that the resulting quads can also have a List or Graph as term value
for await (const { quad, positive } of run(options)) {
  // Do something with the results
  myFunc(quad, positive);
}
```

## How it works

First each surface gets converted into a disjunction of conjunctions.
For the graffiti we keep track of how deep that graffiti was,
to later determine if this is an existential or universal, and how it relates to other graffiti.
Blank nodes with the same name that occur in different scopes will be renamed to prevent issues.

For example:
```n3
() log:onNegativeSurface {
    () log:onNegativeSurface {
        :A a :Statement .
        () log:onNegativeSurface {
            :A a :Statement .
        } .
    } .
    () log:onNegativeSurface {
        :test2 :is true .
    } .
} .
```
Will be converted to `((:A a :Statement) && -(:A a :Statement)) || (:test2 :is true)`,
with `-` indicating negation, `&&` conjunction, and `||` disjunction.
All these surfaces are then put together into a single conjunction at root level,
together with any triples at the root of the document.
Internally in the code level 0/1/2 is used to refer to the root clause, disjunction level, and (internal) conjunction level.

The reasoner has three main reasoning "blocks",
which each correspond to a set of logical rules that get applied to the known dataset to generate/improve data.
These each get executed in a fixed order.
One such iteration is called a `step`.
The maximum amount of steps that the reasoner should execute can be set using the CLI.
The three blocks are called "simplify", "bind", and "overlap".

By default, the reasoner will keep going until it really can't find anything new,
or it solves an answer surface.

### Simplify

This step tries to remove clauses or triples to simplify their interpretation.

At conjunction level this is done by trying to find a contradiction with the root triples and other triples in the conjunction.
E.g., using `A,B,C,...` for constants, `x,y,z,...` for variables, and `f,g,h,...` for functions (as stand-in for triples),
knowing `∀x: f(x)` allows us to reduce `g(B) || (-f(A) && g(C))` to `g(B)`.

In the same way we look for tautologies at disjunction level, e.g. `f(A) || -f(A)`.
Finding one of these allows us to remove the disjunction completely as it won't give us interesting information.

On both levels we also remove duplicates or similar superfluous information.
E.g., `∀x: f(x) || f(A)` becomes `∀x: f(x)`.

### Bind

In this step we generate new clauses by binding universals to specific constants that might lead to better results.
How to bind which universal to which variable is determined
by trying to match root level triples with triple patterns in any clause.
For example, knowing `:A a :Statement` and `∀x: (?x a :Statement) || (?x a :Person)`,
would result in the new clause `(:A a :Statement) || (:A a :Person)`.

Bind results are cached, so the same binding will not be tried twice.
Newly generated triples will first be simplified,
after which the reasoner will check if it already knows this information or not,
either by having an identical clause, or one that is more specific.
Only if this is not the case will the new clause be added to known data.
The same applies for the clauses generated in the overlap step below.

### Overlap

In the overlap step the reasoner tries to combine two clauses to generate a new clause.
This is done by finding parts of two clauses that contradict each other and replacing them with the rest.
E.g, `f(A) || f(B)` and `-f(A) || f(C)` will result in `f(B) || f(C)`.

Overlap is also checked by comparing conjunction parts,
so `f(A) || (f(B) && f(C))` and `g(A) || (-f(B) && g(C))` will result in two new clauses:
`f(A) || (g(A) && f(C))` and `g(A) || (f(A) && g(C))`.

Overlap can also be done with universals present.
`∀x: f(x) || g(x)` and `-f(A) || g(B)` will generate `g(A) || g(B)`.

As a pruning strategy, overlap results that have more quads than their parents combined,
will not be stored.

### Built-ins

Tension has some support for [N3 built-ins](https://w3c.github.io/N3/reports/20230703/builtins.html).
Each built-in implementation can fulfill two functions:
a boolean check to determine if the statement is true/false,
and a bind step where a new clause can be generated by replacing blank nodes with values determined by the built-in.
Every built-in is implemented in its own file that exposes the functions necessary to do this,
these can be seen in [src/builtins](src/builtins).
New built-ins can be supported by adding a file to that folder.

For example, `f(A) || f(B) || sum((2 3), 20)` would be replaced with `f(A) || f(B)` as the sum check returns false.
`f(x) || f(B) || sum((2 3), x)` would be replaced with `f(5) || f(B)` as the built-in would apply the binding `x: 5`.
