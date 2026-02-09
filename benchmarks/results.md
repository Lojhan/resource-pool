| Name                               | Duration (ms) |    Ops/Sec |
| :--------------------------------- | ------------: | ---------: |
| GenericObjectPool (Static/Sync)    |         98.74 | 10,127,612 |
| GenericObjectPool (Engine/Index)   |        114.67 |  8,720,727 |
| GenericObjectPool (Dynamic/Sync)   |         165.4 |  6,045,994 |
| GenericObjectPool (Engine) .use()  |        203.83 |  4,906,147 |
| GenericObjectPool (Static) .use()  |        208.65 |  4,792,609 |
| GenericObjectPool (Dynamic) .use() |        217.22 |  4,603,536 |
| generic-pool (Async)               |        670.11 |  1,492,293 |
| generic-pool .use()                |        700.59 |  1,427,365 |
| tarn (Pure JS/Async)               |        992.29 |  1,007,765 |
| tarn (manual .use)                 |       1099.27 |    909,696 |
