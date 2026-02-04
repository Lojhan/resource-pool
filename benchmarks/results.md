| Command                                                 |     Mean [ms] | Min [ms] | Max [ms] |    Relative |
| :------------------------------------------------------ | ------------: | -------: | -------: | ----------: |
| `node benchmarks/run-single.js generic-object-pool`     |  195.7 ± 16.6 |    174.3 |    228.9 |        1.00 |
| `node benchmarks/run-single.js generic-object-pool-use` |  323.5 ± 39.8 |    280.8 |    411.8 | 1.65 ± 0.25 |
| `node benchmarks/run-single.js generic-pool`            |  800.9 ± 28.4 |    749.9 |    827.8 | 4.09 ± 0.38 |
| `node benchmarks/run-single.js generic-pool-use`        |  850.2 ± 28.4 |    799.4 |    911.4 | 4.35 ± 0.40 |
| `node benchmarks/run-single.js tarn`                    | 1121.2 ± 45.3 |   1053.3 |   1174.7 | 5.73 ± 0.54 |
| `node benchmarks/run-single.js tarn-use`                | 1148.6 ± 63.7 |   1056.4 |   1239.6 | 5.87 ± 0.60 |
