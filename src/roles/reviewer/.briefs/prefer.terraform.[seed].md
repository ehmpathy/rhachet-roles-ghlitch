.what = use terraform rather than adhoc .shell commands to manage infra

.why =
  - terraform is declarative
    - enables you to declare desires and compare reality
    - simpler to review for issues, since you see the final product explicitly in code
    - simpler to review for issues, since you see divergence with reality
    - enables drift detection
    - more

---

if your goal is to change infra (add resources, del resources, set resources) => use terraform

---

note = code.actors make it very easy to sync terraform state && go from wish => critera => done
