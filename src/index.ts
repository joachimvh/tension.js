// TODO: look into ((f(A) || g(A)) && \exists x: (f(x) || g(x)) => TEST)

// TODO: random notes, should perhaps keep these to prevent making the same mistakes
//
//       f(A) || g(B) is not a contradiction for \forall x: f(x) && g(x)
//       f(A) || g(A) is though, so need to track bindings while doing this
//
// TODO: \forall x: f(x) && -f(A) -> contradiction
//       \exists x,y: f(x) && -f(y) -> /
//       \forall x: f(x) || -f(A) -> /
//       \forall x,y: f(x) || -f(y) -> /
//       \exists x: f(x) || -f(A) -> tautology
//
// not sure about correctness for triples with multiple blank nodes
//
// TODO: assumption below is wrong.
//       f(A) && \exists x: A || -f(x) does not imply A!
//       f(A) && \exists x: (f(x) && B) || g(x) does not imply \exists B || g(x)!
//         no wait, actually it does I think
//
//       f(A) && \forall x: B || (f(x) && C) does not imply B!
//
//       (A & B) || -A -> actually not a tautology because B = false and A = true.
//
// f(A) && \forall x: -f(x) || g(x) does not imply \forall g(x), only g(A)!
//
// TODO: can one universal actually imply the other universal can be removed?
//       \forall x, y: f(x) || f(y) || g(x) || h(y)
//         -> \forall x, y: f(y) || g(x) || h(y) ???
//         -> \forall x, y: f(x) || g(x) || h(y) ???
//         -> both???
//         makes sense, since if we have an `f` match for `x`, we can use the same value for the `y`???
//       does \forall x, y: f(x) || f(A) || g(x) imply \forall x, y: f(x) || g(x) ? -> yes
//
// TODO: f(A) || g(A)
//       \forall x: -f(x) || h(x)
//       \forall y: -g(y) || h(y)
//
//
//       \forall x: (-f(x) || h(x)) && (-g(x) || h(x))
//       -> \forall x: h(x) || (-f(x) && -g(x))
//       ...
//
//
//       could first see if there is a potential pattern match before applying bindings
//       -f(A) || h(A) + -g(A) || h(A) (could do this step implicitly)
//       -> g(A) || h(A) + f(A) || h(A)
//       -> (combine with results from first line) h(A) || h(A)
//
//       \forall x: f(A, x) || B || g(x)
//       \forall y: -f(y, C) || D || h(y)
//       -> \forall z: B || D || g(z) || h(z) (could also keep original quantifiers though, prolly easier)
//          is the above actually correct with how we merge quantifiers?
//          actually not, result should be B || D || g(A) || h(C)!!! (because f(A, x) and -f(y, C) could both be true for all values that are not C/A)
//
//       \forall x: f(x) || B || g(x)
//       \forall y: -f(y) || C || h(y)
//       -> \forall z: B || C || g(z) || h(z)
//       (use new variable to prevent potential issues with future combinations,
//       on the other hand, won't replace all of them though so not that relevant, need to be the same though)
//       -> again: is this true though? -> yes, because every value needs at least one of those
//
//       A || B || C
//       -A || -B || E
//       -> B || C || -B || E
//       -> so as soon as we have 2 matches this operation is useless
//       on the other hand, can immediately stop after 1 match as the useless ones will be simplified away ... probably
//
// \forall x, y: g(x) || (f(x) && f(y)) is different from \forall x, y, z: g(z) || (f(x) && f(y))

export * from './BindUtil';
export * from './ClauseUtil';
export * from './LogUtil';
export * from './OverlapUtil';
export * from './ParseUtil';
export * from './ReasonUtil';
export * from './Run';
export * from './SimplifyUtil';
