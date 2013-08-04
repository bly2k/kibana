'use strict';

angular.module('kibana.stats', [])
.controller('stats', function ($scope, querySrv, dashboard, filterSrv)
{
  $scope.panelMeta = {
    status: "Stable",
    description: "Displays a statistical aggregration (count, total, avg, max, min, terms/distinct count) of a numeric field."
  };

  var _d = {
    queries: {
      mode: 'all',
      ids: [],
      queryString: ""
    },
    field: "",
    statistic: "count",
    decimals: 0,
    decimalSeparator: ".",
    commaSeparator: ",",
    termsCountMax: 100000,
    style: {},
    formatString: "{0}",
    spyable : true
  };

  _.defaults($scope.panel, _d);

  // I really don't like this function, too much dom manip. Break out into directive?
  $scope.populate_modal = function(request) {
    $scope.modal = {
      title: "Inspector",
      body : "<h5>Last Elasticsearch Query</h5><pre>"+
        'curl -XGET '+config.elasticsearch+'/'+dashboard.indices+"/_search?pretty -d'\n"+
        angular.toJson(JSON.parse(request.toString()),true)+
      "'</pre>", 
    }; 
  };

  $scope.set_refresh = function (state)
  {
    $scope.refresh = state;
  };

  $scope.close_edit = function ()
  {
    if ($scope.refresh)
    {
      $scope.get_data();
    }
    $scope.refresh = false;
    $scope.$emit('render');
  };

  $scope.init = function ()
  {
    $scope.$on('refresh', function ()
    {
      $scope.get_data();
    });
    $scope.get_data();
  };

  $scope.get_data = function (segment, query_id)
  {
    delete $scope.panel.error;

    // Make sure we have everything for the request to complete
    if (dashboard.indices.length === 0 || $scope.panel.field == "") {
      return;
    }

    $scope.panelMeta.loading = true;

    var request = $scope.ejs.Request().indices(dashboard.indices);

    $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

    var facetFilter = querySrv.getFacetFilter(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);

    var mode = $scope.panel.statistic;

    switch (mode)
    {
      case "termscount":
        request = request
         .facet($scope.ejs.TermsFacet('terms')
          .field($scope.panel.field)
          .facetFilter(facetFilter)
          .size($scope.panel.termsCountMax)).size(0);
        break;

      default:
        request = request
         .facet($scope.ejs.StatisticalFacet('stats')
          .field($scope.panel.field)
          .facetFilter(facetFilter)).size(0);
        break;
    }

    //alert(request.toString());

    // Populate the inspector panel
    $scope.populate_modal(request);

    var results = request.doSearch();

    results.then(function (results) {
      $scope.panelMeta.loading = false;
      $scope.hits = results.hits.total;

      var scripts = $LAB.script("common/lib/jquery.number.min.js");
      
      scripts.wait(function()
      {
        var statistic = 0;

        switch (mode)
        {
          case "termscount":
            statistic = results.facets.terms.terms.length;
            break;

          default:
            statistic = results.facets.stats[mode];
            break;
        }

        var formatted = $.number(statistic, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
        if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != "")
          formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);

        $scope.statistic = formatted;

        $scope.$emit('render');
      });
    });
  };
});